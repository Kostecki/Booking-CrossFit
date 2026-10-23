import { Alert, List, Loader, Stack, Switch } from "@mantine/core";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import {
	deletePushSubscription,
	savePushSubscription,
	sendTestNotification,
} from "#/server/push.functions.ts";

import { notifyError, notifyInfo } from "./notify.ts";
import { SettingsGroup, SettingsRow } from "./Settings.tsx";

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
	const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4))
		.replace(/-/g, "+")
		.replace(/_/g, "/");
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
	const registration = await navigator.serviceWorker.ready;
	return registration.pushManager.getSubscription();
}

export function NotificationsGroup({
	publicKey,
}: {
	publicKey: string | null;
}) {
	const save = useServerFn(savePushSubscription);
	const remove = useServerFn(deletePushSubscription);
	const sendTest = useServerFn(sendTestNotification);
	const [state, setState] = useState<State>("loading");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		const supported =
			"serviceWorker" in navigator &&
			"PushManager" in window &&
			"Notification" in window;
		if (!supported) {
			setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
		} else if (!publicKey) {
			setState("not-configured");
		} else if (Notification.permission === "denied") {
			setState("denied");
		} else {
			currentSubscription().then(
				(sub) => setState(sub ? "on" : "off"),
				() => setState("off"),
			);
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
			if (!publicKey) return;
			const permission = await Notification.requestPermission();
			if (permission !== "granted") {
				setState(permission === "denied" ? "denied" : "off");
				return;
			}
			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: base64UrlToBytes(publicKey),
			});
			const { endpoint, keys } = subscription.toJSON();
			if (!endpoint || !keys?.p256dh || !keys.auth) {
				throw new Error("Browseren returnerede et ufuldstændigt abonnement.");
			}
			await save({
				data: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
			});
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
			notifyInfo(
				delivered > 0
					? "Testnotifikation sendt."
					: "Ingen enheder modtog den. Slå notifikationer til igen.",
			);
		});

	// Why the switch can't be used, if it can't.
	const unavailable = {
		"ios-install": "Kræver at appen er føjet til hjemmeskærmen.",
		unsupported: "Din browser understøtter ikke notifikationer.",
		"not-configured": "Notifikationer er ikke sat op på serveren endnu.",
		denied:
			"Notifikationer er blokeret. Tillad dem for denne side i browserens eller telefonens indstillinger.",
		loading: undefined,
		off: undefined,
		on: undefined,
	}[state];

	return (
		<Stack gap="xs">
			<SettingsGroup
				label="Notifikationer"
				footer={
					unavailable ??
					"Få besked, når der er booket hold til dig, eller hvis dit login holder op med at virke."
				}
			>
				<SettingsRow
					label="Tillad notifikationer"
					right={
						// Flipping it is a tap, which iOS requires for the permission prompt.
						<Switch
							aria-label="Tillad notifikationer"
							checked={state === "on"}
							disabled={busy || (state !== "on" && state !== "off")}
							onChange={(event) =>
								event.currentTarget.checked ? enable() : disable()
							}
						/>
					}
				/>
				{state === "on" && (
					<SettingsRow
						label="Send testnotifikation"
						onClick={test}
						disabled={busy}
						right={busy ? <Loader size={16} /> : undefined}
					/>
				)}
			</SettingsGroup>
			{state === "ios-install" && (
				<Alert color="blue" title="Føj appen til hjemmeskærmen">
					<List size="sm" type="ordered">
						<List.Item>Tryk på Del-knappen i Safari</List.Item>
						<List.Item>Vælg "Føj til hjemmeskærm"</List.Item>
						<List.Item>
							Åbn appen fra hjemmeskærmen og slå notifikationer til her
						</List.Item>
					</List>
				</Alert>
			)}
		</Stack>
	);
}
