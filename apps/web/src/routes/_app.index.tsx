import {
	Badge,
	Button,
	Card,
	Divider,
	Group,
	Loader,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import { useClickOutside } from "@mantine/hooks";
import { IconPlayerPlay } from "@tabler/icons-react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";

import { ConfirmButton } from "#/components/ConfirmButton.tsx";
import { takeFreshRequest } from "#/components/freshness.ts";
import { notifyError, notifyInfo } from "#/components/notify.ts";
import { requestRun } from "#/server/runs.functions.ts";
import {
	getUpcoming,
	setRebook,
	setSkip,
	type UpcomingClass,
} from "#/server/upcoming.functions.ts";

export const Route = createFileRoute("/_app/")({
	loader: () => getUpcoming({ data: { fresh: takeFreshRequest() } }),
	pendingComponent: () => <Loader m="xl" />,
	component: Upcoming,
});

const STATE_BADGE: Record<
	UpcomingClass["state"],
	{ label: string; color: string }
> = {
	booked: { label: "Booket", color: "green" },
	waitlist: { label: "Venteliste", color: "yellow" },
	planned: { label: "Planlagt", color: "gray" },
	cancelled: { label: "Afmeldt", color: "red" },
};

function Upcoming() {
	const { user } = Route.useRouteContext();
	const { classes, hasSchedule } = Route.useLoaderData();
	// What's actually held on BookingBoard comes first, apart from planned/cancelled/skipped.
	const isHeld = (cls: UpcomingClass) =>
		cls.state === "booked" || cls.state === "waitlist";
	const booked = classes.filter(isHeld);
	const notBooked = classes.filter((cls) => !isHeld(cls));
	const router = useRouter();
	const runNow = useServerFn(requestRun);
	const [running, setRunning] = useState(false);

	async function onRunNow() {
		setRunning(true);
		try {
			const result = await runNow();
			if (!result.ok) {
				notifyInfo(result.error);
				return;
			}
			await router.navigate({ to: "/history" });
		} catch (error) {
			notifyError(error);
		} finally {
			setRunning(false);
		}
	}

	if (!hasSchedule) {
		return (
			<Card withBorder>
				<Stack gap="sm" align="flex-start">
					<Title order={4}>Vælg dine faste hold</Title>
					<Text size="sm" c="dimmed">
						Vælg hvilke hold du vil have booket hver uge, så bookes de
						automatisk.
					</Text>
					<Button component={Link} to="/schedule">
						Vælg hold
					</Button>
				</Stack>
			</Card>
		);
	}
	return (
		<Stack gap="xs">
			<Group justify="space-between" wrap="nowrap" mb="xs">
				<Stack gap={0} miw={0}>
					<Title order={4}>Dine bookinger</Title>
					<Text size="xs" c="dimmed">
						Bookes automatisk hver aften kl. 19
					</Text>
				</Stack>
				<Button
					size="xs"
					variant="outline"
					leftSection={<IconPlayerPlay size={14} />}
					loading={running}
					disabled={user.status === "needs_reauth"}
					onClick={onRunNow}
					style={{ flexShrink: 0 }}
				>
					Book nu
				</Button>
			</Group>
			{classes.length === 0 && (
				<Text c="dimmed">Ingen kommende hold endnu.</Text>
			)}
			{booked.map((cls) => (
				<ClassRow key={cls.classId} cls={cls} />
			))}
			{booked.length > 0 && notBooked.length > 0 && (
				<Divider label="Kommende bookinger" labelPosition="left" my={4} />
			)}
			{notBooked.map((cls) => (
				<ClassRow key={cls.classId} cls={cls} />
			))}
		</Stack>
	);
}

function ClassRow({ cls }: { cls: UpcomingClass }) {
	const router = useRouter();
	const skip = useServerFn(setSkip);
	const rebook = useServerFn(setRebook);
	// Guards against double taps. No loading state on these small text buttons:
	// Mantine's label/spinner animation reads as a flicker for a sub-second request.
	const busy = useRef(false);
	// Optimistic changes shown right away, until the reloaded list arrives (or the request fails).
	const [patch, setPatch] =
		useState<Partial<Pick<UpcomingClass, "skipped" | "rebookPending">>>();
	const view = { ...cls, ...patch };
	// One pill per row: a cancelled class reads "Genbookes" once a rebooking is queued.
	const badge = view.skipped
		? { label: "Springes over", color: "gray" }
		: view.state === "cancelled" && view.rebookPending
			? { label: "Genbookes", color: "blue" }
			: STATE_BADGE[view.state];
	const held = view.state === "booked" || view.state === "waitlist";

	async function act(fn: () => Promise<unknown>, optimistic?: typeof patch) {
		if (busy.current) return;
		busy.current = true;
		setPatch(optimistic);
		try {
			await fn();
			// sync: wait for the reloaded list, not just the start of the reload, so the
			// optimistic patch is only dropped once the real state is on screen.
			await router.invalidate({ sync: true });
		} catch (error) {
			notifyError(error);
		} finally {
			setPatch(undefined);
			busy.current = false;
		}
	}
	const setSkipped = (enabled: boolean) =>
		skip({ data: { classId: cls.classId, begins: cls.begins, enabled } });

	let action = null;
	if (view.skipped) {
		action = (
			<Button
				size="xs"
				variant="subtle"
				onClick={() => act(() => setSkipped(false), { skipped: false })}
			>
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
	} else if (view.state === "planned") {
		action = (
			<Button
				size="xs"
				variant="subtle"
				onClick={() => act(() => setSkipped(true), { skipped: true })}
			>
				Spring over
			</Button>
		);
	} else if (view.rebookPending) {
		action = (
			<Button
				size="xs"
				variant="subtle"
				onClick={() =>
					act(
						() => rebook({ data: { classId: cls.classId, enabled: false } }),
						{ rebookPending: false },
					)
				}
			>
				Fortryd
			</Button>
		);
	} else {
		action = (
			<Button
				size="xs"
				variant="subtle"
				onClick={() =>
					act(() => rebook({ data: { classId: cls.classId, enabled: true } }), {
						rebookPending: true,
					})
				}
			>
				Genbook
			</Button>
		);
	}

	return (
		<Card withBorder padding="sm" opacity={view.skipped ? 0.6 : 1}>
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
						<StatusBadge label={badge.label} color={badge.color} />
					</Group>
				</Stack>
				{action}
			</Group>
		</Card>
	);
}

// Badges whose meaning isn't obvious get a tooltip; touch opens it too, since phones can't hover.
const BADGE_HELP: Record<string, string> = {
	Afmeldt:
		"Du er afmeldt holdet. Det bookes ikke igen automatisk - tryk Genbook, hvis du vil booke igen.",
	Genbookes:
		"Bookes igen ved næste kørsel, eller når du trykker Book nu - hvis der er plads.",
};

function StatusBadge({ label, color }: { label: string; color: string }) {
	const help = BADGE_HELP[label];
	if (!help) {
		return (
			<Badge size="sm" variant="light" color={color}>
				{label}
			</Badge>
		);
	}
	return <HelpBadge label={label} color={color} help={help} />;
}

// Controlled rather than Mantine's built-in events, which don't open on a tap: a tap
// toggles it and a tap elsewhere closes it; hover only reacts to a real mouse, since
// phones also fire pointerenter on tap, which would open and immediately re-close it.
function HelpBadge({
	label,
	color,
	help,
}: {
	label: string;
	color: string;
	help: string;
}) {
	const [opened, setOpened] = useState(false);
	const ref = useClickOutside(() => setOpened(false));
	return (
		<Tooltip label={help} opened={opened} multiline w={240} withArrow>
			<Badge
				ref={ref}
				size="sm"
				variant="light"
				color={color}
				style={{ cursor: "help" }}
				onClick={() => setOpened((o) => !o)}
				onPointerEnter={(e) => e.pointerType === "mouse" && setOpened(true)}
				onPointerLeave={(e) => e.pointerType === "mouse" && setOpened(false)}
			>
				{label}
			</Badge>
		</Tooltip>
	);
}
