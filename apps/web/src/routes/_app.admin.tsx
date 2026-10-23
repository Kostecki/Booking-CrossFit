import {
	ActionIcon,
	Badge,
	Button,
	Code,
	Group,
	Loader,
	Modal,
	ScrollArea,
	Spoiler,
	Stack,
	Switch,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { ConfirmButton } from "#/components/ConfirmButton.tsx";
import { notifyError, notifyInfo } from "#/components/notify.ts";
import { SettingsGroup, SettingsRow } from "#/components/Settings.tsx";
import {
	type AdminUser,
	type DebugEntry,
	getAdminOverview,
	getRunLog,
	requestRunAll,
	setRunTimes,
	setUserStatus,
} from "#/server/admin.functions.ts";

export const Route = createFileRoute("/_app/admin")({
	beforeLoad: ({ context }) => {
		if (!context.user.isAdmin) throw redirect({ to: "/" });
	},
	loader: () => getAdminOverview(),
	pendingComponent: () => <Loader m="xl" />,
	component: Admin,
});

// The worker writes its heartbeat every 15 s.
const WORKER_STALE_MS = 60_000;

const formatDateTime = (iso: string) =>
	new Date(iso).toLocaleString("da-DK", {
		timeZone: "Europe/Copenhagen",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});

function Admin() {
	const data = Route.useLoaderData();
	const router = useRouter();

	// Keep the worker status current while the page is open.
	useEffect(() => {
		const timer = setInterval(() => router.invalidate(), 15_000);
		return () => clearInterval(timer);
	}, [router]);

	return (
		<Stack gap="lg">
			<Title order={4}>Admin</Title>
			<RunTimes saved={data.runTimes} nextRun={data.heartbeat?.nextRun} />
			<Worker heartbeat={data.heartbeat} runAllPending={data.runAllPending} />
			<Users users={data.users} />
			<FailedRuns runs={data.failedRuns} days={data.failedRunsDays} />
			<DebugLog entries={data.debugLog} />
		</Stack>
	);
}

function RunTimes({
	saved,
	nextRun,
}: {
	saved: string[];
	nextRun?: string | null;
}) {
	const router = useRouter();
	const save = useServerFn(setRunTimes);
	const [times, setTimes] = useState(saved);
	const [busy, setBusy] = useState(false);
	const dirty = times.join() !== saved.join();

	// Take over newly saved times, but don't clobber edits on the 15 s refresh.
	const savedKey = saved.join();
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the values
	useEffect(() => setTimes(saved), [savedKey]);

	return (
		<SettingsGroup
			label="Kørselstider"
			footer={
				<>
					Den automatiske booking kører for alle brugere på disse tidspunkter
					(dansk tid). Workeren henter ændringer inden for 15 sekunder.
					{nextRun && <> Næste kørsel: {formatDateTime(nextRun)}.</>}
				</>
			}
		>
			{times.map((time, index) => (
				<SettingsRow
					// biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
					key={index}
					label={
						<TextInput
							type="time"
							value={time}
							aria-label={`Tidspunkt ${index + 1}`}
							onChange={(event) => {
								const value = event.currentTarget.value;
								setTimes((all) => all.map((t, i) => (i === index ? value : t)));
							}}
						/>
					}
					right={
						<ActionIcon
							variant="subtle"
							color="gray"
							aria-label="Fjern"
							disabled={times.length === 1}
							onClick={() =>
								setTimes((all) => all.filter((_, i) => i !== index))
							}
						>
							<IconX size={18} />
						</ActionIcon>
					}
				/>
			))}
			<SettingsRow
				label={
					<Group gap={6}>
						<IconPlus size={16} />
						Tilføj tidspunkt
					</Group>
				}
				disabled={times.length >= 4}
				onClick={() => setTimes((all) => [...all, "07:00"])}
			/>
			<SettingsRow
				label="Gem"
				right={
					<Button
						size="xs"
						loading={busy}
						disabled={!dirty}
						onClick={async () => {
							setBusy(true);
							try {
								const result = await save({ data: { times } });
								if (!result.ok) {
									notifyError(result.error);
									return;
								}
								notifyInfo("Kørselstiderne er gemt");
								await router.invalidate();
							} catch (error) {
								notifyError(error);
							} finally {
								setBusy(false);
							}
						}}
					>
						Gem
					</Button>
				}
			/>
		</SettingsGroup>
	);
}

function Worker({
	heartbeat,
	runAllPending,
}: {
	heartbeat: {
		at: string;
		nextRun: string | null;
		dailyInProgress: boolean;
	} | null;
	runAllPending: boolean;
}) {
	const router = useRouter();
	const runAll = useServerFn(requestRunAll);
	const alive =
		heartbeat !== null &&
		Date.now() - Date.parse(heartbeat.at) < WORKER_STALE_MS;

	return (
		<SettingsGroup label="Worker">
			<SettingsRow
				label="Status"
				right={
					<Badge color={alive ? "green" : "red"} variant="light">
						{/* Whether the worker process is up, not whether it's booking */}
						{!heartbeat
							? "Aldrig set"
							: alive
								? "Online"
								: `Offline · sidst set ${formatDateTime(heartbeat.at)}`}
					</Badge>
				}
			/>
			<SettingsRow
				label="Booking i gang"
				right={
					<Text c="dimmed">
						{heartbeat?.dailyInProgress
							? "Ja"
							: runAllPending
								? "Starter snart"
								: "Nej"}
					</Text>
				}
			/>
			<SettingsRow
				label="Kør for alle nu"
				right={
					<ConfirmButton
						size="xs"
						variant="light"
						disabled={heartbeat?.dailyInProgress || runAllPending}
						title="Kør for alle nu"
						message="Starter den automatiske booking for alle aktive brugere, præcis som en planlagt kørsel (med de samme tilfældige pauser)."
						confirmLabel="Start"
						onConfirm={async () => {
							await runAll();
							await router.invalidate();
						}}
					>
						Start
					</ConfirmButton>
				}
			/>
		</SettingsGroup>
	);
}

const STATUS_LOOK = {
	active: { label: "Aktiv", color: "green" },
	paused: { label: "Pause", color: "gray" },
	needs_reauth: { label: "Login afvist", color: "red" },
} as const;

const RUN_STATUS_LABEL: Record<string, string> = {
	ok: "OK",
	error: "Fejl",
	running: "Kører",
};

function Users({ users }: { users: AdminUser[] }) {
	const router = useRouter();
	const updateStatus = useServerFn(setUserStatus);

	return (
		<SettingsGroup
			label={`Brugere (${users.length})`}
			footer="Kontakten sætter auto-booking på pause for brugeren. Brugere med afvist login skal selv logge ind igen."
		>
			{users.map((user) => {
				const look = STATUS_LOOK[user.status];
				return (
					<SettingsRow
						key={user.id}
						label={
							<Stack gap={2} component="span">
								<Group gap={6} component="span">
									<Text span fw={500}>
										{user.fullName}
									</Text>
									<Badge size="xs" color={look.color} variant="light">
										{look.label}
									</Badge>
									{user.isAdmin && (
										<Badge size="xs" variant="outline">
											Admin
										</Badge>
									)}
								</Group>
								<Text span size="xs" c="dimmed">
									{user.slots} hold · oprettet {formatDateTime(user.createdAt)}
									{user.lastRun &&
										` · seneste kørsel ${RUN_STATUS_LABEL[user.lastRun.status] ?? user.lastRun.status} ${formatDateTime(user.lastRun.at)}`}
								</Text>
							</Stack>
						}
						right={
							<Switch
								aria-label={`Auto-booking for ${user.fullName}`}
								checked={user.status === "active"}
								disabled={user.status === "needs_reauth"}
								onChange={async (event) => {
									try {
										await updateStatus({
											data: {
												userId: user.id,
												paused: !event.currentTarget.checked,
											},
										});
										await router.invalidate();
									} catch (error) {
										notifyError(error);
									}
								}}
							/>
						}
					/>
				);
			})}
		</SettingsGroup>
	);
}

function FailedRuns({
	runs,
	days,
}: {
	runs: {
		id: number;
		userName: string;
		trigger: string;
		at: string;
		error: string | null;
	}[];
	days: number;
}) {
	const fetchLog = useServerFn(getRunLog);
	const [log, setLog] = useState<{ title: string; text: string } | null>(null);

	if (runs.length === 0) {
		return (
			<SettingsGroup label="Fejlede kørsler">
				<SettingsRow
					label={<Text c="dimmed">Ingen de sidste {days} dage</Text>}
				/>
			</SettingsGroup>
		);
	}
	return (
		<>
			<SettingsGroup
				label={`Fejlede kørsler (${runs.length})`}
				footer={`De sidste ${days} dage. Tryk for at se loggen.`}
			>
				{runs.map((run) => (
					<SettingsRow
						key={run.id}
						label={
							<Stack gap={2} component="span">
								<Text span>
									{run.userName} · {formatDateTime(run.at)}
									{run.trigger === "manual" && " · manuel"}
								</Text>
								{run.error && (
									<Text span size="xs" c="red">
										{run.error}
									</Text>
								)}
							</Stack>
						}
						onClick={async () => {
							try {
								const result = await fetchLog({ data: { runId: run.id } });
								setLog({
									title: `${run.userName} · ${formatDateTime(run.at)}`,
									text: result.log || result.error || "(tom log)",
								});
							} catch (error) {
								notifyError(error);
							}
						}}
					/>
				))}
			</SettingsGroup>
			<Modal
				opened={log !== null}
				onClose={() => setLog(null)}
				title={log?.title}
				size="xl"
				centered
			>
				<ScrollArea.Autosize mah="70vh">
					<Code block>{log?.text}</Code>
				</ScrollArea.Autosize>
			</Modal>
		</>
	);
}

function DebugLog({ entries }: { entries: DebugEntry[] }) {
	return (
		<SettingsGroup
			label="Venteliste-debug"
			footer="De nyeste linjer fra waitlist-debug.jsonl i datamappen."
		>
			{entries.length === 0 ? (
				<SettingsRow label={<Text c="dimmed">Ingen hændelser endnu</Text>} />
			) : (
				entries.map((entry, index) => (
					<SettingsRow
						// biome-ignore lint/suspicious/noArrayIndexKey: the log is append-only
						key={index}
						label={
							<Stack gap={4} component="span" miw={0} w="100%">
								<Text span size="sm">
									<Text span fw={500}>
										{entry.kind}
									</Text>{" "}
									· bruger {entry.userId} · {formatDateTime(entry.at)}
								</Text>
								<Spoiler maxHeight={0} showLabel="Vis data" hideLabel="Skjul">
									<Code block fz="xs">
										{entry.data}
									</Code>
								</Spoiler>
							</Stack>
						}
					/>
				))
			)}
		</SettingsGroup>
	);
}
