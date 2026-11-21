import { cancelBooking } from "@booking/core/api";
import {
	BookingVerificationError,
	bookOrReactivate,
	danishDateLabel,
	getTimePartsInZone,
	isCancelled,
	matchingSlot,
	occupancy,
} from "@booking/core/automation";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { scheduleSlots } from "#/db/schema.ts";

import {
	forgetBookings,
	loadBookings,
	loadTimetable,
	MAX_TOTAL_SESSIONS,
	TIME_ZONE,
	withBookingToken,
} from "./bookingboard.ts";
import { authMiddleware } from "./middleware.ts";
import {
	deleteRebook,
	deleteSkip,
	pendingRebookClassIds,
	skippedClassIds,
	upsertRebook,
} from "./rebooks.ts";

export type ClassOption = {
	classId: number;
	title: string;
	begins: string;
	dateLabel: string; // "Fredag 27. November"
	time: string; // "16:30"
	occupancy?: string; // "12/16"
	// From the timetable, cached for up to 30 minutes.
	full: boolean;
	// The user's registration, or "planned" when the schedule will book it.
	myState?: "booked" | "waitlist" | "cancelled" | "planned";
	skipped: boolean;
	rebookPending: boolean;
};

export type ClassDay = {
	key: string; // "2026-11-27"
	dateLabel: string;
	classes: ClassOption[];
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Every upcoming class in the timetable by day, plus the classes the user holds. */
export const getClassList = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.validator((input?: { fresh?: boolean }) => ({
		fresh: input?.fresh === true,
	}))
	.handler(
		async ({
			data: { fresh },
			context: { user },
		}): Promise<{
			days: ClassDay[];
			held: ClassOption[];
			limit: number;
		}> => {
			const [bookings, classes] = await Promise.all([
				loadBookings(user, { fresh }),
				loadTimetable(user),
			]);
			const slots = db
				.select()
				.from(scheduleSlots)
				.where(eq(scheduleSlots.userId, user.id))
				.all();
			const skipped = skippedClassIds(user.id);
			const rebooks = pendingRebookClassIds(user.id);
			const registrations = new Map(bookings.map((b) => [b.classId, b]));
			const nowMs = Date.now();

			const days = new Map<string, ClassDay>();
			const held: ClassOption[] = [];
			const sorted = classes
				.map((cls) => ({ cls, ms: Date.parse(cls.begins) }))
				.filter(({ ms }) => Number.isFinite(ms) && ms > nowMs)
				.sort((a, b) => a.ms - b.ms);
			for (const { cls, ms } of sorted) {
				const { year, month, day, hour, minute } = getTimePartsInZone(
					ms,
					TIME_ZONE,
				);
				const registration = registrations.get(cls.id);
				const myState = registration
					? isCancelled(registration.status)
						? "cancelled"
						: registration.status === "SignedUp"
							? "booked"
							: "waitlist"
					: matchingSlot(cls, ms, slots, TIME_ZONE)
						? "planned"
						: undefined;
				const option: ClassOption = {
					classId: cls.id,
					title: cls.title,
					begins: cls.begins,
					dateLabel: danishDateLabel(ms, TIME_ZONE),
					time: `${pad(hour)}:${pad(minute)}`,
					occupancy: occupancy(cls),
					full: cls.hasSeatsLeft === false,
					myState,
					skipped: skipped.has(cls.id),
					rebookPending: rebooks.has(cls.id),
				};
				if (myState === "booked" || myState === "waitlist") held.push(option);
				const key = `${year}-${pad(month)}-${pad(day)}`;
				let entry = days.get(key);
				if (!entry) {
					entry = { key, dateLabel: option.dateLabel, classes: [] };
					days.set(key, entry);
				}
				entry.classes.push(option);
			}
			return { days: [...days.values()], held, limit: MAX_TOTAL_SESSIONS };
		},
	);

/**
 * Book a class outside the schedule. At the gym's limit, `cancelClassId` (one of the
 * held classes) is cancelled first and queued for rebooking, so the automation books
 * it again once there's room, before any later class.
 *
 * Not serialised with the worker's runs (that lock is per process). An overlapping run
 * can't overbook: it re-reads the bookings and stops at the limit.
 */
export const bookOneOff = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator((input: { classId: number; cancelClassId?: number }) => {
		if (
			!Number.isSafeInteger(input?.classId) ||
			(input.cancelClassId !== undefined &&
				!Number.isSafeInteger(input.cancelClassId))
		) {
			throw new Error("Invalid input");
		}
		return { classId: input.classId, cancelClassId: input.cancelClassId };
	})
	.handler(
		async ({
			data: { classId, cancelClassId },
			context: { user },
		}): Promise<{ waitingList: boolean }> => {
			const accountId = user.bbAccountId;
			// Always fresh: the limit and what to cancel must match BookingBoard now.
			const [bookings, classes] = await Promise.all([
				loadBookings(user, { fresh: true }),
				loadTimetable(user),
			]);
			const nowMs = Date.now();
			const cls = classes.find((c) => c.id === classId);
			if (!cls || Date.parse(cls.begins) <= nowMs) {
				throw new Error("Holdet findes ikke længere.");
			}
			const held = bookings.filter(
				(b) => !isCancelled(b.status) && Date.parse(b.begins) > nowMs,
			);
			if (held.some((b) => b.classId === classId)) {
				throw new Error("Du er allerede booket på holdet.");
			}

			let toCancel: (typeof held)[number] | undefined;
			if (held.length >= MAX_TOTAL_SESSIONS) {
				toCancel = held.find((b) => b.classId === cancelClassId);
				if (!toCancel) {
					throw new Error(
						`Du har allerede ${MAX_TOTAL_SESSIONS} bookinger. Vælg en, der skal afmeldes.`,
					);
				}
			}

			// Put the cancelled class back as it was; best-effort, and its rebook
			// request stays queued if that fails, so the next run picks it up.
			const undoCancel = async (token: string, cancelledId: number) => {
				try {
					const current = await loadBookings(user, { fresh: true });
					await bookOrReactivate(token, {
						classId: cancelledId,
						accountId,
						bookings: current,
					});
					deleteRebook(user.id, cancelledId);
				} catch {
					// Left as Genbookes.
				}
			};

			const book = async (token: string) => {
				if (toCancel) {
					await cancelBooking(token, {
						participationId: toCancel.id,
						classHourId: toCancel.classId,
						accountId,
					});
					deleteSkip(user.id, toCancel.classId);
					upsertRebook(user.id, toCancel.classId);
				}
				try {
					return await bookOrReactivate(token, {
						classId,
						accountId,
						bookings,
					});
				} catch (error) {
					if (toCancel) await undoCancel(token, toCancel.classId);
					throw error;
				}
			};
			try {
				const { verified } = await withBookingToken(user, book);
				deleteSkip(user.id, classId);
				return { waitingList: verified.status !== "SignedUp" };
			} catch (error) {
				if (error instanceof BookingVerificationError) {
					throw new Error("Bookingen gik ikke igennem. Prøv igen senere.");
				}
				throw error;
			} finally {
				forgetBookings(user.id);
			}
		},
	);
