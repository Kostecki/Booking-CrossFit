import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { runs } from "#/db/schema.ts";
import { authMiddleware } from "./middleware.ts";

const MANUAL_RUN_COOLDOWN_MS = 10 * 60 * 1000;

export type RunSummary = {
	id: number;
	trigger: "daily" | "manual";
	status: "queued" | "running" | "ok" | "error";
	createdAt: string;
	finishedAt?: string;
	// Danish one-liners of what was booked
	booked: string[];
	error?: string;
};

export const getRuns = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context: { user } }): Promise<RunSummary[]> =>
		db
			.select()
			.from(runs)
			.where(eq(runs.userId, user.id))
			.orderBy(desc(runs.id))
			.limit(30)
			.all()
			.map((run) => ({
				id: run.id,
				trigger: run.trigger,
				status: run.status,
				createdAt: run.createdAt.toISOString(),
				finishedAt: run.finishedAt?.toISOString(),
				booked: run.bookedJson
					? (JSON.parse(run.bookedJson) as { timeLabel: string; labelDa: string }[]).map(
							(b) => `${b.timeLabel} - ${b.labelDa}`,
						)
					: [],
				error: run.error ?? undefined,
			})),
	);

/** Queue an on-demand booking run; the worker picks it up within seconds. */
export const requestRun = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(async ({ context: { user } }) => {
		if (user.status === "needs_reauth") {
			return { ok: false as const, error: "Log ind igen, før der kan bookes." };
		}
		const pending = db
			.select({ id: runs.id })
			.from(runs)
			.where(and(eq(runs.userId, user.id), inArray(runs.status, ["queued", "running"])))
			.get();
		if (pending) return { ok: true as const, runId: pending.id };

		const lastManual = db
			.select({ createdAt: runs.createdAt })
			.from(runs)
			.where(and(eq(runs.userId, user.id), eq(runs.trigger, "manual")))
			.orderBy(desc(runs.id))
			.get();
		const waitMs = lastManual
			? lastManual.createdAt.getTime() + MANUAL_RUN_COOLDOWN_MS - Date.now()
			: 0;
		if (waitMs > 0) {
			return {
				ok: false as const,
				error: `Du kan booke igen om ${Math.ceil(waitMs / 60000)} min.`,
			};
		}

		const run = db
			.insert(runs)
			.values({ userId: user.id, trigger: "manual" })
			.returning({ id: runs.id })
			.get();
		return { ok: true as const, runId: run.id };
	});
