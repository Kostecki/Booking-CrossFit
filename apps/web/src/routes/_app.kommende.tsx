import { Badge, Button, Card, Group, Loader, Stack, Text } from "@mantine/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ConfirmButton } from "#/components/ConfirmButton.tsx";
import { notifyError } from "#/components/notify.ts";
import {
	getUpcoming,
	setRebook,
	setSkip,
	type UpcomingClass,
} from "#/server/upcoming.functions.ts";

export const Route = createFileRoute("/_app/kommende")({
	loader: () => getUpcoming(),
	pendingComponent: () => <Loader m="xl" />,
	component: Upcoming,
});

const STATE_BADGE: Record<UpcomingClass["state"], { label: string; color: string }> = {
	booked: { label: "Booket", color: "green" },
	waitlist: { label: "Venteliste", color: "yellow" },
	planned: { label: "Planlagt", color: "gray" },
	cancelled: { label: "Aflyst", color: "red" },
};

function Upcoming() {
	const classes = Route.useLoaderData();

	if (classes.length === 0) {
		return (
			<Text c="dimmed">
				Ingen kommende hold. Vælg dine faste hold under "Hold", så dukker de op her.
			</Text>
		);
	}
	return (
		<Stack gap="xs">
			<Text size="sm" c="dimmed">
				"Planlagt" er hold, der passer til dit skema. De bookes, når der er plads inden for
				dine 5 bookinger.
			</Text>
			{classes.map((cls) => (
				<ClassRow key={cls.classId} cls={cls} />
			))}
		</Stack>
	);
}

function ClassRow({ cls }: { cls: UpcomingClass }) {
	const router = useRouter();
	const skip = useServerFn(setSkip);
	const rebook = useServerFn(setRebook);
	const [busy, setBusy] = useState(false);
	const badge = cls.skipped ? { label: "Springes over", color: "gray" } : STATE_BADGE[cls.state];
	const held = cls.state === "booked" || cls.state === "waitlist";

	async function act(fn: () => Promise<unknown>) {
		setBusy(true);
		try {
			await fn();
			await router.invalidate();
		} catch (error) {
			notifyError(error);
		} finally {
			setBusy(false);
		}
	}
	const setSkipped = (enabled: boolean) =>
		skip({ data: { classId: cls.classId, begins: cls.begins, enabled } });

	let action = null;
	if (cls.skipped) {
		action = (
			<Button size="xs" variant="subtle" loading={busy} onClick={() => act(() => setSkipped(false))}>
				Fortryd
			</Button>
		);
	} else if (held) {
		action = (
			<ConfirmButton
				size="xs"
				variant="subtle"
				color="red"
				title="Spring over"
				message={`Det aflyser din booking til ${cls.title} ${cls.dateLabel} kl. ${cls.time}, og pladsen går til det næste hold i dit skema.`}
				confirmLabel="Aflys og spring over"
				onConfirm={() => act(() => setSkipped(true))}
			>
				Spring over
			</ConfirmButton>
		);
	} else if (cls.state === "planned") {
		action = (
			<Button size="xs" variant="subtle" loading={busy} onClick={() => act(() => setSkipped(true))}>
				Spring over
			</Button>
		);
	} else if (cls.rebookPending) {
		action = (
			<Button
				size="xs"
				variant="subtle"
				loading={busy}
				onClick={() => act(() => rebook({ data: { classId: cls.classId, enabled: false } }))}
			>
				Fortryd genbooking
			</Button>
		);
	} else {
		action = (
			<Button
				size="xs"
				variant="light"
				loading={busy}
				onClick={() => act(() => rebook({ data: { classId: cls.classId, enabled: true } }))}
			>
				Book igen én gang
			</Button>
		);
	}

	return (
		<Card withBorder padding="sm" opacity={cls.skipped ? 0.6 : 1}>
			<Group justify="space-between" wrap="nowrap">
				<Stack gap={2}>
					<Text fw={500}>
						{cls.dateLabel} · {cls.time}
					</Text>
					<Group gap="xs">
						<Text size="sm" c="dimmed">
							{cls.title}
							{cls.occupancy ? ` (${cls.occupancy})` : ""}
						</Text>
						<Badge size="sm" variant="light" color={badge.color}>
							{badge.label}
						</Badge>
						{cls.rebookPending && !cls.skipped && (
							<Badge size="sm" variant="light" color="blue">
								Genbookes
							</Badge>
						)}
					</Group>
				</Stack>
				{action}
			</Group>
		</Card>
	);
}
