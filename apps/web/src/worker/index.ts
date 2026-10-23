// Booking worker: the daily run(s) for every active user, at the times set in the admin
// page (app_settings.runTimes, default 19:00), plus on-demand runs queued from the app. Run with: node --env-file-if-exists=.env src/worker/index.ts
//
// Flags (for testing): --daily-now runs the daily job once at startup; --no-jitter
// skips the random delays. DRY_RUN=1 computes and logs without booking.
import { runTimeCron } from "@booking/core/runTimes";
import { Cron } from "croner";
import { asc, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { runs, scheduleSlots, users } from "#/db/schema.ts";
import {
	deleteSetting,
	getRunTimes,
	getSetting,
	setSetting,
} from "#/server/appSettings.ts";
import { TIME_ZONE } from "#/server/bookingboard.ts";

import { loadUser, runForUser } from "./runForUser.ts";

const dryRun = ["1", "true", "yes"].includes(
	(process.env.DRY_RUN ?? "").toLowerCase(),
);
const noJitter = process.argv.includes("--no-jitter");
const QUEUE_POLL_MS = 15_000;
const RETRY_DELAY_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomMs = (minMs: number, maxMs: number) =>
	noJitter ? 0 : minMs + Math.random() * (maxMs - minMs);

function shuffle<T>(items: T[]): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

// Users with a run in progress. Two runs for the same user at once could double-book.
const busyUsers = new Set<number>();

async function exclusive<T>(userId: number, fn: () => Promise<T>): Promise<T> {
	while (busyUsers.has(userId)) await sleep(1000);
	busyUsers.add(userId);
	try {
		return await fn();
	} finally {
		busyUsers.delete(userId);
	}
}

async function runDaily(): Promise<void> {
	const startDelay = randomMs(0, 10 * 60_000);
	console.log(`Daily run starts in ${Math.round(startDelay / 1000)}s`);
	await sleep(startDelay);

	const userIds = shuffle(
		db
			.selectDistinct({ id: users.id })
			.from(users)
			.innerJoin(scheduleSlots, eq(scheduleSlots.userId, users.id))
			.where(eq(users.status, "active"))
			.all()
			.map((u) => u.id),
	);
	console.log(
		`Daily run for ${userIds.length} user(s)${dryRun ? " (DRY RUN)" : ""}`,
	);

	const retry: number[] = [];
	for (const [index, userId] of userIds.entries()) {
		if (index > 0) await sleep(randomMs(30_000, 120_000));
		if ((await runDailyForUser(userId)) === "transient_error")
			retry.push(userId);
	}

	if (retry.length > 0) {
		console.log(
			`Retrying ${retry.length} user(s) in ${RETRY_DELAY_MS / 60_000} min`,
		);
		await sleep(noJitter ? 0 : RETRY_DELAY_MS);
		for (const [index, userId] of retry.entries()) {
			if (index > 0) await sleep(randomMs(30_000, 120_000));
			await runDailyForUser(userId);
		}
	}
	console.log("Daily run finished");
}

async function runDailyForUser(userId: number) {
	return exclusive(userId, async () => {
		// Re-read: the user may have paused, been flagged or deleted while we waited.
		const user = loadUser(userId);
		if (user?.status !== "active") return "ok" as const;
		const run = db
			.insert(runs)
			.values({ userId, trigger: "daily", status: "running" })
			.returning({ id: runs.id })
			.get();
		return runForUser(user, run.id, dryRun);
	});
}

let draining = false;

/** Process queued manual runs, oldest first. Users busy with a daily run are left queued. */
async function drainQueue(): Promise<void> {
	if (draining) return;
	draining = true;
	try {
		for (;;) {
			const queued = db
				.select()
				.from(runs)
				.where(eq(runs.status, "queued"))
				.orderBy(asc(runs.id))
				.all()
				.find((run) => !busyUsers.has(run.userId));
			if (!queued) return;

			const user = loadUser(queued.userId);
			if (!user) continue; // cascade-deleted with its runs
			if (user.status === "needs_reauth") {
				db.update(runs)
					.set({
						status: "error",
						finishedAt: new Date(),
						error: "Log ind igen, før der kan bookes.",
					})
					.where(eq(runs.id, queued.id))
					.run();
				continue;
			}
			await exclusive(user.id, () => runForUser(user, queued.id, dryRun));
		}
	} finally {
		draining = false;
	}
}

// Runs left "running" by a crash or restart will never finish.
db.update(runs)
	.set({
		status: "error",
		finishedAt: new Date(),
		error: "Afbrudt (workeren blev genstartet)",
	})
	.where(eq(runs.status, "running"))
	.run();

let dailyInProgress = false;

/** Start a daily run for everyone, unless one is already going (runs are idempotent). */
async function startDaily(reason: string): Promise<void> {
	if (dailyInProgress) {
		console.log(`${reason}: skipped, a daily run is already in progress`);
		return;
	}
	console.log(`${reason}: starting daily run`);
	dailyInProgress = true;
	try {
		await runDaily();
	} catch (error) {
		console.error("Daily run failed", error);
	} finally {
		dailyInProgress = false;
	}
}

// One cron per run time; rebuilt when an admin changes the times.
let runTimes: string[] = [];
let crons: Cron[] = [];

function scheduleRuns(): void {
	const times = getRunTimes();
	if (times.join() === runTimes.join()) return;
	for (const cron of crons) cron.stop();
	runTimes = times;
	crons = times.map(
		(time) =>
			new Cron(runTimeCron(time), { timezone: TIME_ZONE, protect: true }, () =>
				startDaily(`Scheduled ${time}`),
			),
	);
	console.log(
		`Daily runs at ${times.join(", ")}. Next: ${nextRun()?.toISOString()}`,
	);
}

const nextRun = () =>
	crons
		.map((cron) => cron.nextRun())
		.filter((date) => date !== null)
		.sort((a, b) => a.getTime() - b.getTime())[0];

/** Every poll: pick up new run times and run-all requests, and report that we're alive. */
function poll(): void {
	scheduleRuns();
	if (getSetting("runAllRequestedAt")) {
		deleteSetting("runAllRequestedAt");
		void startDaily("Requested by an admin");
	}
	setSetting("workerHeartbeat", {
		at: new Date().toISOString(),
		nextRun: nextRun()?.toISOString() ?? null,
		dailyInProgress,
	});
	drainQueue().catch((error) => console.error("Queue failed", error));
}

const queueTimer = setInterval(() => {
	try {
		poll();
	} catch (error) {
		console.error("Poll failed", error);
	}
}, QUEUE_POLL_MS);

console.log(`Worker started.${dryRun ? " (DRY RUN)" : ""}`);
poll();
if (process.argv.includes("--daily-now")) void startDaily("--daily-now");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		console.log(
			`${signal}: stopping${dailyInProgress ? " (daily run interrupted)" : ""}`,
		);
		for (const cron of crons) cron.stop();
		clearInterval(queueTimer);
		process.exit(0);
	});
}
