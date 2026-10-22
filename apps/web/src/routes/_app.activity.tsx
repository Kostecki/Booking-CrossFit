import { Badge, Card, Group, Loader, Stack, Text } from "@mantine/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { getRuns, type RunSummary } from "#/server/runs.functions.ts";

export const Route = createFileRoute("/_app/activity")({
	loader: () => getRuns(),
	pendingComponent: () => <Loader m="xl" />,
	component: Activity,
});

const STATUS_BADGE: Record<
	RunSummary["status"],
	{ label: string; color: string }
> = {
	queued: { label: "I kø", color: "gray" },
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

	if (runs.length === 0) {
		return (
			<Text c="dimmed" ta="center" mt="md">
				Ingen bookinger foretaget
			</Text>
		);
	}
	return (
		<Stack gap="xs">
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
