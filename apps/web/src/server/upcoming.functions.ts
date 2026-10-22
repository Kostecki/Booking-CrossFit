import { cancelBooking, getMyBookings } from "@booking/core/api";
import {
	danishDateLabel,
	getTimePartsInZone,
	isCancelled,
	matchingSlot,
} from "@booking/core/automation";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, lt } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { rebookRequests, scheduleSlots, skips } from "#/db/schema.ts";
import { getUpcomingClasses, TIME_ZONE, withBookingToken } from "./bookingboard.ts";
import { authMiddleware } from "./middleware.ts";

export type UpcomingClass = {
	classId: number;
	title: string;
	begins: string;
	dateLabel: string; // "Tirsdag 3. November"
	time: string; // "17:30"
	// booked/waitlist: held on BookingBoard; planned: matches the schedule, not booked yet;
	// cancelled: an opted-out registration.
	state: "booked" | "waitlist" | "planned" | "cancelled";
	skipped: boolean;
	rebookPending: boolean;
	occupancy?: string; // "12/16"
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The user's held and cancelled bookings plus the schedule's planned classes, by date. */
export const getUpcoming = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context: { user } }): Promise<UpcomingClass[]> => {
		const [bookings, classes] = await withBookingToken(user, (token) =>
			Promise.all([getMyBookings(token, user.bbAccountId), getUpcomingClasses(token)]),
		);
		const nowMs = Date.now();
		db.delete(skips)
			.where(and(eq(skips.userId, user.id), lt(skips.begins, new Date(nowMs).toISOString())))
			.run();

		const slots = db.select().from(scheduleSlots).where(eq(scheduleSlots.userId, user.id)).all();
		const skipped = new Set(
			db.select().from(skips).where(eq(skips.userId, user.id)).all().map((s) => s.classId),
		);
		const rebooks = new Set(
			db
				.select()
				.from(rebookRequests)
				.where(and(eq(rebookRequests.userId, user.id), eq(rebookRequests.status, "pending")))
				.all()
				.map((r) => r.classId),
		);
		const classesById = new Map(classes.map((c) => [c.id, c]));

		const rows = new Map<number, UpcomingClass>();
		const row = (
			classId: number,
			title: string,
			begins: string,
			state: UpcomingClass["state"],
		): UpcomingClass => {
			const ms = Date.parse(begins);
			const { hour, minute } = getTimePartsInZone(ms, TIME_ZONE);
			const cls = classesById.get(classId);
			return {
				classId,
				title,
				begins,
				dateLabel: danishDateLabel(ms, TIME_ZONE),
				time: `${pad(hour)}:${pad(minute)}`,
				state,
				skipped: skipped.has(classId),
				rebookPending: rebooks.has(classId),
				occupancy:
					cls?.numberOfParticipants !== undefined && cls.maximumNumberOfParticipants !== undefined
						? `${cls.numberOfParticipants}/${cls.maximumNumberOfParticipants}`
						: undefined,
			};
		};

		for (const b of bookings) {
			const ms = Date.parse(b.begins);
			if (!Number.isFinite(ms) || ms <= nowMs) continue;
			const state = isCancelled(b.status) ? "cancelled" : b.status === "SignedUp" ? "booked" : "waitlist";
			const cls = classesById.get(b.classId);
			// Only show cancellations that relate to the schedule or a request.
			if (
				state === "cancelled" &&
				!skipped.has(b.classId) &&
				!rebooks.has(b.classId) &&
				!(cls && matchingSlot(cls, ms, slots, TIME_ZONE))
			) {
				continue;
			}
			rows.set(b.classId, row(b.classId, b.className, b.begins, state));
		}
		for (const cls of classes) {
			const ms = Date.parse(cls.begins);
			if (!Number.isFinite(ms) || ms <= nowMs || rows.has(cls.id)) continue;
			if (matchingSlot(cls, ms, slots, TIME_ZONE)) {
				rows.set(cls.id, row(cls.id, cls.title, cls.begins, "planned"));
			}
		}

		return [...rows.values()].sort((a, b) => Date.parse(a.begins) - Date.parse(b.begins));
	});

const classInput = (input: { classId: number; begins?: string; enabled: boolean }) => {
	if (!Number.isSafeInteger(input?.classId) || typeof input.enabled !== "boolean") {
		throw new Error("Invalid input");
	}
	const begins = typeof input.begins === "string" ? input.begins : "";
	return { classId: input.classId, begins, enabled: input.enabled };
};

/**
 * Skip a single class: cancel it on BookingBoard if held, and never book it again.
 * Un-skipping a class that was cancelled queues a one-time rebooking for it.
 */
export const setSkip = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(classInput)
	.handler(async ({ data: { classId, begins, enabled }, context: { user } }) => {
		const accountId = user.bbAccountId;
		const bookings = await withBookingToken(user, (token) => getMyBookings(token, accountId));
		const registration = bookings.find((b) => b.classId === classId);

		if (enabled) {
			if (registration && !isCancelled(registration.status)) {
				await withBookingToken(user, (token) =>
					cancelBooking(token, { participationId: registration.id, classHourId: classId, accountId }),
				);
			}
			db.insert(skips)
				.values({ userId: user.id, classId, begins: registration?.begins ?? begins })
				.onConflictDoNothing()
				.run();
			db.delete(rebookRequests)
				.where(and(eq(rebookRequests.userId, user.id), eq(rebookRequests.classId, classId)))
				.run();
			return;
		}

		db.delete(skips).where(and(eq(skips.userId, user.id), eq(skips.classId, classId))).run();
		if (registration && isCancelled(registration.status)) {
			upsertRebook(user.id, classId);
		}
	});

function upsertRebook(userId: number, classId: number) {
	db.insert(rebookRequests)
		.values({ userId, classId })
		.onConflictDoUpdate({
			target: [rebookRequests.userId, rebookRequests.classId],
			set: { status: "pending" },
		})
		.run();
}

/** Ask for (or withdraw) a one-time rebooking of a cancelled class. */
export const setRebook = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(classInput)
	.handler(async ({ data: { classId, enabled }, context: { user } }) => {
		if (enabled) {
			db.delete(skips).where(and(eq(skips.userId, user.id), eq(skips.classId, classId))).run();
			upsertRebook(user.id, classId);
		} else {
			db.delete(rebookRequests)
				.where(and(eq(rebookRequests.userId, user.id), eq(rebookRequests.classId, classId)))
				.run();
		}
	});
