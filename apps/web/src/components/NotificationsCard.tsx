import { Alert, Button, Card, Group, List, Stack, Text, Title } from "@mantine/core";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
	deletePushSubscription,
	savePushSubscription,
	sendTestNotification,
} from "#/server/push.functions.ts";
import { notifyError, notifyInfo } from "./notify.ts";

type State =
	| "loading"
	| "ios-install" // iOS only allows push from an app added to the Home Screen
	| "unsupported"
	| "not-configured"
	| "denied"
	| "off"
	| "on";

const isIos = () =>
	/iPad|iPhone|iPod/.test(navigator.userAgent) ||
	(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
	window.matchMedia("(display-mode: standalone)").matches ||
	(navigator as Navigator & { standalone?: boolean }).standalone === true;

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
	const registration = await navigator.serviceWorker.ready;
	return registration.pushManager.getSubscription();
}

export function NotificationsCard({ publicKey }: { publicKey: string | null }) {
	const save = useServerFn(savePushSubscription);
	const remove = useServerFn(deletePushSubscription);
	const sendTest = useServerFn(sendTestNotification);
	const [state, setState] = useState<State>("loading");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
		if (!supported) {
			setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
		} else if (!publicKey) {
			setState("not-configured");
		} else if (Notification.permission === "denied") {
			setState("denied");
		} else {
			currentSubscription().then((sub) => setState(sub ? "on" : "off"), () => setState("off"));
		}
	}, [publicKey]);

	async function withBusy(fn: () => Promise<void>) {
		setBusy(true);
		try {
			await fn();
		} catch (error) {
			notifyError(error);
		} finally {
			setBusy(false);
		}
	}

	// Must run directly from a tap: iOS refuses permission prompts that aren't user-initiated.
	const enable = () =>
		withBusy(async () => {
			const permission = await Notification.requestPermission();
			if (permission !== "granted") {
				setState(permission === "denied" ? "denied" : "off");
				return;
			}
			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: base64UrlToBytes(publicKey!),
			});
			const { endpoint, keys } = subscription.toJSON();
			await save({ data: { endpoint: endpoint!, keys: { p256dh: keys!.p256dh!, auth: keys!.auth! } } });
			setState("on");
		});

	const disable = () =>
		withBusy(async () => {
			const subscription = await currentSubscription();
			if (subscription) {
				await remove({ data: { endpoint: subscription.endpoint } });
				await subscription.unsubscribe();
			}
			setState("off");
		});

	const test = () =>
		withBusy(async () => {
			const { delivered } = await sendTest();
			notifyInfo(delivered > 0 ? "Testnotifikation sendt." : "Ingen enheder modtog den. Slå notifikationer til igen.");
		});

	return (
		<Card withBorder>
			<Stack gap="xs">
				<Title order={5}>Notifikationer</Title>
				<Text size="sm" c="dimmed">
					Få besked, når der er booket hold til dig, eller hvis dit login holder op med at virke.
				</Text>
				{state === "ios-install" && (
					<Alert color="blue" title="Føj appen til hjemmeskærmen">
						<List size="sm" type="ordered">
							<List.Item>Tryk på Del-knappen i Safari</List.Item>
							<List.Item>Vælg "Føj til hjemmeskærm"</List.Item>
							<List.Item>Åbn appen fra hjemmeskærmen og slå notifikationer til her</List.Item>
						</List>
					</Alert>
				)}
				{state === "unsupported" && (
					<Text size="sm">Din browser understøtter ikke notifikationer.</Text>
				)}
				{state === "not-configured" && (
					<Text size="sm">Notifikationer er ikke sat op på serveren endnu.</Text>
				)}
				{state === "denied" && (
					<Text size="sm">
						Notifikationer er blokeret. Tillad dem for denne side i browserens eller telefonens
						indstillinger.
					</Text>
				)}
				{state === "off" && (
					<Button onClick={enable} loading={busy}>
						Slå notifikationer til
					</Button>
				)}
				{state === "on" && (
					<>
						<Text size="sm">Slået til på denne enhed.</Text>
						<Group>
							<Button variant="light" onClick={test} loading={busy}>
								Send testnotifikation
							</Button>
							<Button variant="subtle" color="gray" onClick={disable} disabled={busy}>
								Slå fra
							</Button>
						</Group>
					</>
				)}
			</Stack>
		</Card>
	);
}
