import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { rebookRequests, skips } from "#/db/schema.ts";

/** Queue (or re-queue) a one-time rebooking of a cancelled class. */
export function upsertRebook(userId: number, classId: number): void {
	db.insert(rebookRequests)
		.values({ userId, classId })
		.onConflictDoUpdate({
			target: [rebookRequests.userId, rebookRequests.classId],
			set: { status: "pending" },
		})
		.run();
}

export function deleteRebook(userId: number, classId: number): void {
	db.delete(rebookRequests)
		.where(
			and(
				eq(rebookRequests.userId, userId),
				eq(rebookRequests.classId, classId),
			),
		)
		.run();
}

export function deleteSkip(userId: number, classId: number): void {
	db.delete(skips)
		.where(and(eq(skips.userId, userId), eq(skips.classId, classId)))
		.run();
}

export const skippedClassIds = (userId: number) =>
	new Set(
		db
			.select({ classId: skips.classId })
			.from(skips)
			.where(eq(skips.userId, userId))
			.all()
			.map((s) => s.classId),
	);

export const pendingRebookClassIds = (userId: number) =>
	new Set(
		db
			.select({ classId: rebookRequests.classId })
			.from(rebookRequests)
			.where(
				and(
					eq(rebookRequests.userId, userId),
					eq(rebookRequests.status, "pending"),
				),
			)
			.all()
			.map((r) => r.classId),
	);
