import { ApiError } from "@booking/core/api";
import {
	type BookedClass,
	findCompletedRebooks,
	formatBookedDa,
	runBookingAutomation,
} from "@booking/core/automation";
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
	rebookRequests,
	runs,
	scheduleSlots,
	skips,
	type User,
	users,
} from "#/db/schema.ts";
import {
	MAX_TOTAL_SESSIONS,
	NeedsReauthError,
	TIME_ZONE,
	withBookingToken,
} from "#/server/bookingboard.ts";
import { notifyUser } from "#/server/notify.ts";
import { recordWaitlistDebug } from "#/server/waitlistDebug.ts";

export type RunOutcome = "ok" | "transient_error" | "error";

/** Network failures and 5xx responses are worth one retry; everything else isn't. */
const isTransient = (error: unknown) =>
	(error instanceof ApiError && error.status >= 500) ||
	(error instanceof TypeError && error.message === "fetch failed");

/**
 * Run the booking automation for one user and record it on the given `runs` row.
 * Never throws: failures are stored on the run and reported through the outcome.
 */
export async function runForUser(
	user: User,
	runId: number,
	dryRun: boolean,
): Promise<RunOutcome> {
	const previous = db
		.select({ status: runs.status })
		.from(runs)
		.where(and(eq(runs.userId, user.id), ne(runs.id, runId)))
		.orderBy(desc(runs.id))
		.get();
	const lines: string[] = [];
	const log = (line: string) => {
		lines.push(line);
		console.log(`[user ${user.id}] ${line}`);
		// "[waitlist-debug] <kind> <json>" lines from the core also go to the debug file.
		const [, kind, json] = line.match(/^\[waitlist-debug\] (\S+) (.*)$/s) ?? [];
		if (kind && json)
			recordWaitlistDebug(kind, user.id, JSON.parse(json), line);
	};
	db.update(runs)
		.set({ status: "running", startedAt: new Date() })
		.where(eq(runs.id, runId))
		.run();

	try {
		const slots = db
			.select()
			.from(scheduleSlots)
			.where(eq(scheduleSlots.userId, user.id))
			.all();
		const skipClassIds = db
			.select({ classId: skips.classId })
			.from(skips)
			.where(eq(skips.userId, user.id))
			.all()
			.map((s) => s.classId);
		const pendingRebookClassIds = db
			.select({ classId: rebookRequests.classId })
			.from(rebookRequests)
			.where(
				and(
					eq(rebookRequests.userId, user.id),
					eq(rebookRequests.status, "pending"),
				),
			)
			.all()
			.map((r) => r.classId);

		let booked: BookedClass[] = [];
		await withBookingToken(user, async (token) => {
			booked = await runBookingAutomation({
				token,
				accountId: user.bbAccountId,
				centerTimeZone: TIME_ZONE,
				slots,
				maxTotalSessions: MAX_TOTAL_SESSIONS,
				dryRun,
				pendingRebookClassIds,
				skipClassIds,
				log,
			});
			if (dryRun) return;
			const completed = await findCompletedRebooks(
				token,
				user.bbAccountId,
				pendingRebookClassIds,
			);
			if (completed.length > 0) {
				db.update(rebookRequests)
					.set({ status: "done" })
					.where(
						and(
							eq(rebookRequests.userId, user.id),
							inArray(rebookRequests.classId, completed),
						),
					)
					.run();
			}
		});

		db.update(runs)
			.set({
				status: "ok",
				finishedAt: new Date(),
				bookedJson: JSON.stringify(booked),
				log: lines.join("\n"),
			})
			.where(eq(runs.id, runId))
			.run();

		if (booked.length > 0 && !dryRun) {
			const word = booked.length === 1 ? "træning" : "træninger";
			await notifyUser(user.id, {
				title: `Booket ${booked.length} ${word}`,
				body: booked.map(formatBookedDa).join("\n"),
				url: "/",
			});
		}
		return "ok";
	} catch (error) {
		// A rejected booking may be the gym's 5-booking limit counting waiting-list spots.
		if (
			error instanceof ApiError &&
			error.status >= 400 &&
			error.status < 500 &&
			error.status !== 401
		) {
			recordWaitlistDebug("booking-rejected", user.id, {
				status: error.status,
				message: error.message,
			});
		}
		const reauth = error instanceof NeedsReauthError;
		const message = reauth
			? "BookingBoard afviste dit login. Log ind igen i appen."
			: error instanceof Error
				? error.message
				: String(error);
		log(`Error: ${message}`);
		db.update(runs)
			.set({
				status: "error",
				finishedAt: new Date(),
				error: message,
				log: lines.join("\n"),
			})
			.where(eq(runs.id, runId))
			.run();

		// Tell the user once when their login stops working (status flips to needs_reauth here),
		// and about other failures only when the previous run went fine, so a lasting
		// problem doesn't notify every day.
		if (!dryRun) {
			if (reauth && user.status !== "needs_reauth") {
				await notifyUser(user.id, {
					title: "Log ind igen",
					body: message,
					url: "/login",
				});
			} else if (!reauth && previous?.status !== "error") {
				await notifyUser(user.id, {
					title: "Booking fejlede",
					body: message,
					url: "/activity",
				});
			}
		}
		return isTransient(error) ? "transient_error" : "error";
	}
}

export function loadUser(userId: number): User | undefined {
	return db.select().from(users).where(eq(users.id, userId)).get();
}
