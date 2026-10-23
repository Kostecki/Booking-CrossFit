import { runScheduleLabel } from "@booking/core/runTimes";
import { Badge, Card, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { useRunTimes } from "#/components/runSchedule.ts";
import { getRuns, type RunSummary } from "#/server/runs.functions.ts";

export const Route = createFileRoute("/_app/history")({
	loader: () => getRuns(),
	pendingComponent: () => <Loader m="xl" />,
	component: Activity,
});

const STATUS_BADGE: Record<
	RunSummary["status"],
	{ label: string; color: string }
> = {
	queued: { label: "Venter", color: "gray" },
	running: { label: "Kører", color: "blue" },
	ok: { label: "OK", color: "green" },
	error: { label: "Fejl", color: "red" },
};

const formatTime = (iso: string) =>
	new Date(iso).toLocaleString("da-DK", {
		timeZone: "Europe/Copenhagen",
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});

function Activity() {
	const runs = Route.useLoaderData();
	const runTimes = useRunTimes();
	const router = useRouter();
	const inProgress = runs.some(
		(r) => r.status === "queued" || r.status === "running",
	);

	// Poll while a run is waiting for (or being handled by) the worker.
	useEffect(() => {
		if (!inProgress) return;
		const timer = setInterval(() => router.invalidate(), 3000);
		return () => clearInterval(timer);
	}, [inProgress, router]);

	return (
		<Stack gap="xs">
			<Stack gap={0} mb="xs">
				<Title order={4}>Bookinghistorik</Title>
				<Text size="xs" c="dimmed">
					Dine hold bookes automatisk {runScheduleLabel(runTimes)} og når du
					trykker "Book nu". <br /> Et nyt forsøg står som "Venter" et øjeblik,
					før det starter.
				</Text>
			</Stack>
			{runs.length === 0 && (
				<Text c="dimmed" ta="center" mt="md">
					Ingen bookinger foretaget
				</Text>
			)}
			{runs.map((run) => {
				const badge = STATUS_BADGE[run.status];
				return (
					<Card key={run.id} withBorder padding="sm">
						<Group justify="space-between">
							<Text fw={500}>{formatTime(run.createdAt)}</Text>
							<Group gap="xs">
								<Text size="xs" c="dimmed">
									{run.trigger === "manual" ? "Manuel" : "Daglig"}
								</Text>
								<Badge size="sm" variant="light" color={badge.color}>
									{badge.label}
								</Badge>
							</Group>
						</Group>
						{run.status === "ok" && run.booked.length === 0 && (
							<Text size="sm" c="dimmed">
								Intet nyt at booke.
							</Text>
						)}
						{run.booked.map((line) => (
							<Text key={line} size="sm">
								Booket: {line}
							</Text>
						))}
						{run.error && (
							<Text size="sm" c="red">
								{run.error}
							</Text>
						)}
					</Card>
				);
			})}
		</Stack>
	);
}
