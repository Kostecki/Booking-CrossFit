import {
	bookClass,
	getClassDetail,
	getClasses,
	getMyBookings,
	reactivateBooking,
	toApiDateTime,
} from "../bookingApi.ts";
import type { ClassRegistration, ClazzMobile, Participant } from "../types.ts";

// Statuses that mean the booking no longer counts (cancelled / opted out).
const CANCELLED_STATUSES = new Set(["OptedOut", "OptedOutTooLate"]);

export const isCancelled = (status: string) => CANCELLED_STATUSES.has(status);

// Statuses seen with real data. Anything else is logged with this prefix so the app
// can record it (see apps/web waitlistDebug.ts).
const KNOWN_STATUSES = new Set([
	"SignedUp",
	"OnWaitingList",
	"OptedOut",
	"OptedOutTooLate",
	"OnTime",
	"NeverMet",
]);
export const isKnownStatus = (status: string) => KNOWN_STATUSES.has(status);
export const WAITLIST_DEBUG = "[waitlist-debug]";

// A recurring class to book: this title, on this weekday (0=Sun…6=Sat), at this time.
export type ClassSlot = {
	classTitle: string;
	weekday: number;
	hour: number;
	minute: number;
};

export type BookingAutomationConfig = {
	token: string;
	accountId: number;
	centerTimeZone: string;
	slots: ClassSlot[];
	// Books the next matching classes until this many are held.
	maxTotalSessions: number;
	dryRun: boolean;
	pendingRebookClassIds: number[];
	// Specific class occurrences never to book; the next matching class takes the spot.
	skipClassIds?: number[];
	log?: (line: string) => void;
};

export type BookedClass = {
	classId: number;
	begins: string;
	// e.g. "WOD 17:30"
	timeLabel: string;
	labelEn: string;
	labelDa: string;
	// e.g. " (12/16)", empty when unknown
	occupancy: string;
	waitingList: boolean;
	rebooked: boolean;
};

export function getTimePartsInZone(
	timestampMs: number,
	timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
	const formatter = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});

	const parts = formatter.formatToParts(new Date(timestampMs));
	const getPart = (type: string) =>
		parts.find((part) => part.type === type)?.value;

	return {
		year: Number(getPart("year")),
		month: Number(getPart("month")),
		day: Number(getPart("day")),
		hour: Number(getPart("hour")),
		minute: Number(getPart("minute")),
	};
}

export function weekdayForDate(
	year: number,
	month: number,
	day: number,
): number {
	return new Date(year, month - 1, day).getDay();
}

function isTargetClass(cls: ClazzMobile, targetTitle: string): boolean {
	const target = targetTitle.trim().toUpperCase();
	const title = cls.title?.trim().toUpperCase();
	const type = cls.type?.trim().toUpperCase();
	return title === target || type === target;
}

export function matchingSlot(
	cls: ClazzMobile,
	ms: number,
	slots: ClassSlot[],
	timeZone: string,
): ClassSlot | undefined {
	const { year, month, day, hour, minute } = getTimePartsInZone(ms, timeZone);
	const weekday = weekdayForDate(year, month, day);
	return slots.find(
		(slot) =>
			slot.weekday === weekday &&
			slot.hour === hour &&
			slot.minute === minute &&
			isTargetClass(cls, slot.classTitle),
	);
}

const DA_WEEKDAYS = [
	"Søndag",
	"Mandag",
	"Tirsdag",
	"Onsdag",
	"Torsdag",
	"Fredag",
	"Lørdag",
];
const DA_MONTHS = [
	"Januar",
	"Februar",
	"Marts",
	"April",
	"Maj",
	"Juni",
	"Juli",
	"August",
	"September",
	"Oktober",
	"November",
	"December",
];

// Built manually so it doesn't depend on the runtime shipping Danish ICU data
// (small-icu Node builds silently fall back to English for "da-DK").
export function danishDateLabel(timestampMs: number, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		year: "numeric",
		month: "numeric",
		day: "numeric",
	}).formatToParts(new Date(timestampMs));
	const get = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value);
	const year = get("year");
	const month = get("month");
	const day = get("day");
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	return `${DA_WEEKDAYS[weekday]} ${day}. ${DA_MONTHS[month - 1]}`;
}

function dateLabel(
	timestampMs: number,
	timeZone: string,
	locale: string,
): string {
	if (locale === "da-DK") return danishDateLabel(timestampMs, timeZone);
	return new Date(timestampMs).toLocaleDateString(locale, {
		timeZone,
		weekday: "long",
		day: "numeric",
		month: "long",
	});
}

type Capacity = Pick<
	ClazzMobile,
	| "numberOfParticipants"
	| "numberOfParticipantsOnWaitingList"
	| "maximumNumberOfParticipants"
>;

/**
 * Seats taken out of the total, e.g. "16/16". BookingBoard's numberOfParticipants
 * includes the waiting list, so it's subtracted (a full class would read "17/16").
 */
export function occupancy(cls: Capacity): string | undefined {
	const { numberOfParticipants: count, maximumNumberOfParticipants: max } = cls;
	if (count === undefined || max === undefined) return undefined;
	const taken = Math.max(
		0,
		count - (cls.numberOfParticipantsOnWaitingList ?? 0),
	);
	return `${taken}/${max}`;
}

function occupancyLabel(cls: Capacity): string {
	const value = occupancy(cls);
	return value ? ` (${value})` : "";
}

/**
 * 1-based position of a participation on the class's waiting list, ordered by sign-up
 * time (assumed first come, first served), or undefined if it isn't waiting.
 */
export function waitingListPosition(
	participants: Participant[],
	participationId: number,
): number | undefined {
	const waiting = participants
		.filter((p) => p.status === "OnWaitingList")
		.sort(
			(a, b) => Date.parse(a.signedUpAt ?? "") - Date.parse(b.signedUpAt ?? ""),
		);
	const index = waiting.findIndex((p) => p.id === participationId);
	return index === -1 ? undefined : index + 1;
}

/** Danish one-line summary of a booking, as used in notifications. */
export function formatBookedDa(booked: BookedClass): string {
	const waiting = booked.waitingList ? " (VENTELISTE)" : "";
	return `${booked.timeLabel} - ${booked.labelDa}${booked.occupancy}${waiting}`;
}

/** The pending rebook requests that are now held (not cancelled) on the account. */
export async function findCompletedRebooks(
	token: string,
	accountId: number,
	pendingRebookClassIds: number[],
): Promise<number[]> {
	if (pendingRebookClassIds.length === 0) return [];
	const current = await getMyBookings(token, accountId);
	return pendingRebookClassIds.filter((classId) =>
		current.some(
			(b: ClassRegistration) =>
				b.classId === classId && !CANCELLED_STATUSES.has(b.status),
		),
	);
}

export async function runBookingAutomation({
	token,
	accountId,
	centerTimeZone,
	slots,
	maxTotalSessions,
	dryRun,
	pendingRebookClassIds,
	skipClassIds = [],
	log = console.log,
}: BookingAutomationConfig): Promise<BookedClass[]> {
	const nowMs = Date.now();
	const runDate = new Date(nowMs).toLocaleDateString("en-GB", {
		timeZone: centerTimeZone,
	});
	log(`Today: ${runDate}${dryRun ? "  (DRY RUN)" : ""}\n`);

	// --- Current bookings (past + future) come straight from the account ---
	const bookings = await getMyBookings(token, accountId);
	for (const b of bookings) {
		if (!isKnownStatus(b.status))
			log(`${WAITLIST_DEBUG} unknown-status ${JSON.stringify(b)}`);
	}
	const held = bookings
		.filter((b) => !CANCELLED_STATUSES.has(b.status))
		.map((b) => ({ ...b, ms: Date.parse(b.begins) }))
		.filter((b) => Number.isFinite(b.ms));

	const upcoming = held.filter((b) => b.ms > nowMs).sort((a, b) => a.ms - b.ms);
	// A cancelled registration still exists on the server. Creating another one
	// for the same class is rejected, and a cancellation should be respected.
	const registeredClassIds = new Set(bookings.map((b) => b.classId));
	const heldClassIds = new Set(held.map((b) => b.classId));
	const pendingRebooks = new Set(pendingRebookClassIds);
	const skipped = new Set(skipClassIds);

	const bookedLabels = upcoming.map((b) =>
		dateLabel(b.ms, centerTimeZone, "en-GB"),
	);
	log(
		`Currently booked (upcoming): ${upcoming.length}/${maxTotalSessions}` +
			(bookedLabels.length > 0 ? `\n${bookedLabels.join("\n")}` : "") +
			"\n",
	);

	let upcomingCount = upcoming.length;
	if (upcomingCount >= maxTotalSessions) {
		log(
			`Already at the target of ${maxTotalSessions} booked sessions — nothing to do.`,
		);
		return [];
	}

	// --- One call returns the whole bookable window ---
	const start = getTimePartsInZone(nowMs, centerTimeZone);
	const startIso = toApiDateTime(start.year, start.month, start.day);
	const classes = await getClasses(token, startIso);

	// Candidate sessions: future classes matching any slot (title, weekday and time).
	const candidates = classes
		.map((cls) => ({ cls, ms: Date.parse(cls.begins) }))
		.filter(({ ms }) => Number.isFinite(ms) && ms > nowMs)
		.map(({ cls, ms }) => ({
			cls,
			ms,
			slot: matchingSlot(cls, ms, slots, centerTimeZone),
		}))
		.filter(
			(c): c is { cls: ClazzMobile; ms: number; slot: ClassSlot } =>
				c.slot !== undefined,
		)
		.sort(
			(a, b) =>
				Number(pendingRebooks.has(b.cls.id)) -
					Number(pendingRebooks.has(a.cls.id)) || a.ms - b.ms,
		);

	const newlyBooked: BookedClass[] = [];

	for (const { cls, ms, slot } of candidates) {
		if (upcomingCount >= maxTotalSessions) break;
		if (heldClassIds.has(cls.id)) continue;
		if (skipped.has(cls.id)) continue;
		const rebookRequested = pendingRebooks.has(cls.id);
		if (registeredClassIds.has(cls.id) && !rebookRequested) continue;

		const timeLabel = `${slot.classTitle} ${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`;
		const labelEn = dateLabel(ms, centerTimeZone, "en-GB");
		const labelDa = dateLabel(ms, centerTimeZone, "da-DK");

		if (dryRun) {
			const occ = occupancyLabel(cls);
			const full = cls.hasSeatsLeft === false;
			log(
				`[dry-run] Would ${rebookRequested ? "rebook" : "book"}: ${timeLabel} on ${labelEn}${occ}${full ? " (WAITING LIST)" : ""}`,
			);
			newlyBooked.push({
				classId: cls.id,
				begins: cls.begins,
				timeLabel,
				labelEn,
				labelDa,
				occupancy: occ,
				waitingList: full,
				rebooked: rebookRequested,
			});
			upcomingCount++;
			registeredClassIds.add(cls.id);
			heldClassIds.add(cls.id);
			continue;
		}

		log(
			`${rebookRequested ? "Rebooking" : "Booking"}: ${timeLabel} on ${labelEn}`,
		);
		const cancelled = rebookRequested
			? bookings.find(
					(b) => b.classId === cls.id && CANCELLED_STATUSES.has(b.status),
				)
			: undefined;
		// Kept for the waiting-list debug log below.
		let response: unknown;
		if (cancelled) {
			try {
				response = await reactivateBooking(token, {
					participationId: cancelled.id,
					classHourId: cls.id,
					accountId,
				});
			} catch (error) {
				// The API can remove an opted-out participation when a PUT fails.
				// Re-read before deciding whether a new POST is needed.
				const current = await getMyBookings(token, accountId);
				if (!current.some((b) => b.classId === cls.id)) {
					response = await bookClass(token, { classHourId: cls.id, accountId });
				} else if (
					!current.some(
						(b) => b.classId === cls.id && !CANCELLED_STATUSES.has(b.status),
					)
				) {
					throw error;
				}
			}
		} else {
			response = await bookClass(token, { classHourId: cls.id, accountId });
		}

		// Verify by re-reading the account's bookings.
		const updated = await getMyBookings(token, accountId);
		const verified = updated.find(
			(b) => b.classId === cls.id && !CANCELLED_STATUSES.has(b.status),
		);
		if (!verified) {
			throw new Error(
				`Booking verification failed for ${timeLabel} on ${labelEn}`,
			);
		}

		const onWaitingList = verified.status !== "SignedUp";
		if (onWaitingList) {
			log(
				`${WAITLIST_DEBUG} booked-not-signed-up ${JSON.stringify({ response, verified, class: cls })}`,
			);
		}

		// Occupancy from the class detail (post-booking), for the notification.
		let occ = "";
		try {
			occ = occupancyLabel(await getClassDetail(token, cls.id));
		} catch {
			// Detail is best-effort; booking already succeeded and verified.
		}

		log(
			`Booked and verified: ${timeLabel} on ${labelEn}${occ}${onWaitingList ? " (WAITING LIST)" : ""}`,
		);
		newlyBooked.push({
			classId: cls.id,
			begins: cls.begins,
			timeLabel,
			labelEn,
			labelDa,
			occupancy: occ,
			waitingList: onWaitingList,
			rebooked: rebookRequested,
		});

		upcomingCount++;
		registeredClassIds.add(cls.id);
		heldClassIds.add(cls.id);
	}

	if (newlyBooked.length === 0) {
		log("No new sessions booked.");
	}

	return newlyBooked;
}
