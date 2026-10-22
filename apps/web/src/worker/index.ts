// Booking worker: the daily 19:00 run for every active user, plus on-demand runs
// queued from the app. Run with: node --env-file-if-exists=.env src/worker/index.ts
//
// Flags (for testing): --daily-now runs the daily job once at startup; --no-jitter
// skips the random delays. DRY_RUN=1 computes and logs without booking.
import { Cron } from "croner";
import { asc, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { runs, scheduleSlots, users } from "#/db/schema.ts";
import { TIME_ZONE } from "#/server/bookingboard.ts";
import { loadUser, runForUser } from "./runForUser.ts";

const dryRun = ["1", "true", "yes"].includes((process.env.DRY_RUN ?? "").toLowerCase());
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
		[result[i], result[j]] = [result[j]!, result[i]!];
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
	console.log(`Daily run for ${userIds.length} user(s)${dryRun ? " (DRY RUN)" : ""}`);

	const retry: number[] = [];
	for (const [index, userId] of userIds.entries()) {
		if (index > 0) await sleep(randomMs(30_000, 120_000));
		if ((await runDailyForUser(userId)) === "transient_error") retry.push(userId);
	}

	if (retry.length > 0) {
		console.log(`Retrying ${retry.length} user(s) in ${RETRY_DELAY_MS / 60_000} min`);
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
		if (!user || user.status !== "active") return "ok" as const;
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
					.set({ status: "error", finishedAt: new Date(), error: "Log ind igen, før der kan bookes." })
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
	.set({ status: "error", finishedAt: new Date(), error: "Afbrudt (workeren blev genstartet)" })
	.where(eq(runs.status, "running"))
	.run();

let dailyInProgress = false;
const daily = new Cron("0 19 * * *", { timezone: TIME_ZONE, protect: true }, async () => {
	dailyInProgress = true;
	try {
		await runDaily();
	} catch (error) {
		console.error("Daily run failed", error);
	} finally {
		dailyInProgress = false;
	}
});
const queueTimer = setInterval(() => {
	drainQueue().catch((error) => console.error("Queue failed", error));
}, QUEUE_POLL_MS);

console.log(`Worker started. Next daily run: ${daily.nextRun()?.toISOString()}${dryRun ? " (DRY RUN)" : ""}`);
void drainQueue();
if (process.argv.includes("--daily-now")) void daily.trigger();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		console.log(`${signal}: stopping${dailyInProgress ? " (daily run interrupted)" : ""}`);
		daily.stop();
		clearInterval(queueTimer);
		process.exit(0);
	});
}

