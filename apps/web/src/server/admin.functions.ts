import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRunTimes } from "@booking/core/runTimes";
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, gte, inArray, max, ne } from "drizzle-orm";

import { dataDir, db } from "#/db/index.ts";
import { runs, scheduleSlots, users } from "#/db/schema.ts";

import { getRunTimes, getSetting, setSetting } from "./appSettings.ts";
import { adminMiddleware, authMiddleware } from "./middleware.ts";

const FAILED_RUNS_DAYS = 14;
const DEBUG_LINES = 50;

/** The daily run times, for the copy that mentions them. Any logged-in user. */
export const getRunSchedule = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async () => ({ runTimes: getRunTimes() }));

export type AdminUser = {
	id: number;
	fullName: string;
	status: "active" | "paused" | "needs_reauth";
	isAdmin: boolean;
	slots: number;
	createdAt: string;
	lastRun?: { status: string; at: string };
};

export type FailedRun = {
	id: number;
	userName: string;
	trigger: string;
	at: string;
	error: string | null;
};

export type DebugEntry = {
	at: string;
	kind: string;
	userId: number;
	// Pretty-printed JSON of the entry's data
	data: string;
};

/** Newest entries of waitlist-debug.jsonl (see waitlistDebug.ts), newest first. */
function readDebugLog(): DebugEntry[] {
	let text: string;
	try {
		text = readFileSync(join(dataDir, "waitlist-debug.jsonl"), "utf8");
	} catch {
		return [];
	}
	return text
		.trim()
		.split("\n")
		.filter(Boolean)
		.slice(-DEBUG_LINES)
		.reverse()
		.flatMap((line) => {
			try {
				const entry = JSON.parse(line);
				return [{ ...entry, data: JSON.stringify(entry.data, null, 2) }];
			} catch {
				return [];
			}
		});
}

export const getAdminOverview = createServerFn({ method: "GET" })
	.middleware([adminMiddleware])
	.handler(async () => {
		const slotCounts = new Map(
			db
				.select({ userId: scheduleSlots.userId, slots: count() })
				.from(scheduleSlots)
				.groupBy(scheduleSlots.userId)
				.all()
				.map((row) => [row.userId, row.slots]),
		);
		const lastRunIds = db
			.select({ id: max(runs.id) })
			.from(runs)
			.where(ne(runs.status, "queued"))
			.groupBy(runs.userId)
			.all()
			.map((row) => row.id)
			.filter((id) => id !== null);
		const lastRuns = new Map(
			(lastRunIds.length > 0
				? db.select().from(runs).where(inArray(runs.id, lastRunIds)).all()
				: []
			).map((run) => [
				run.userId,
				{
					status: run.status,
					at: (run.finishedAt ?? run.createdAt).toISOString(),
				},
			]),
		);
		const userList: AdminUser[] = db
			.select()
			.from(users)
			.orderBy(users.fullName)
			.all()
			.map((user) => ({
				id: user.id,
				fullName: user.fullName,
				status: user.status,
				isAdmin: user.isAdmin,
				slots: slotCounts.get(user.id) ?? 0,
				createdAt: user.createdAt.toISOString(),
				lastRun: lastRuns.get(user.id),
			}));

		const since = new Date(Date.now() - FAILED_RUNS_DAYS * 24 * 60 * 60_000);
		const failedRuns: FailedRun[] = db
			.select({
				id: runs.id,
				userName: users.fullName,
				trigger: runs.trigger,
				createdAt: runs.createdAt,
				error: runs.error,
			})
			.from(runs)
			.innerJoin(users, eq(users.id, runs.userId))
			.where(and(eq(runs.status, "error"), gte(runs.createdAt, since)))
			.orderBy(desc(runs.id))
			.all()
			.map(({ createdAt, ...run }) => ({
				...run,
				at: createdAt.toISOString(),
			}));

		return {
			runTimes: getRunTimes(),
			heartbeat: getSetting("workerHeartbeat") ?? null,
			runAllPending: getSetting("runAllRequestedAt") !== undefined,
			users: userList,
			failedRuns,
			failedRunsDays: FAILED_RUNS_DAYS,
			debugLog: readDebugLog(),
		};
	});

export const setRunTimes = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.validator((input: { times: string[] }) => {
		if (!Array.isArray(input?.times)) throw new Error("Invalid input");
		return { times: input.times.map(String) };
	})
	.handler(async ({ data: { times } }) => {
		const result = normalizeRunTimes(times);
		if (!result.ok) return result;
		setSetting("runTimes", result.times);
		return result;
	});

export const setUserStatus = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.validator((input: { userId: number; paused: boolean }) => {
		if (!Number.isSafeInteger(input?.userId)) throw new Error("Invalid input");
		return { userId: input.userId, paused: input.paused === true };
	})
	.handler(async ({ data: { userId, paused } }) => {
		// Users who need to log in again stay that way; only they can fix it.
		db.update(users)
			.set({ status: paused ? "paused" : "active" })
			.where(and(eq(users.id, userId), ne(users.status, "needs_reauth")))
			.run();
	});

/** Ask the worker to start a run for every active user (picked up within 15 s). */
export const requestRunAll = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.handler(async () => {
		setSetting("runAllRequestedAt", new Date().toISOString());
	});

export const getRunLog = createServerFn({ method: "GET" })
	.middleware([adminMiddleware])
	.validator((input: { runId: number }) => {
		if (!Number.isSafeInteger(input?.runId)) throw new Error("Invalid input");
		return input;
	})
	.handler(async ({ data: { runId } }) => {
		const run = db
			.select({ log: runs.log, error: runs.error })
			.from(runs)
			.where(eq(runs.id, runId))
			.get();
		return { log: run?.log ?? "", error: run?.error ?? null };
	});
