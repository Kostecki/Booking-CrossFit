import {
	bookClass,
	getClassDetail,
	getClasses,
	getMyBookings,
	reactivateBooking,
	toApiDateTime,
} from "../bookingApi.ts";
import type { ClassRegistration, ClazzMobile } from "../types.ts";

// Statuses that mean the booking no longer counts (cancelled / opted out).
const CANCELLED_STATUSES = new Set(["OptedOut", "OptedOutTooLate"]);

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
	// participantId (as string) -> display name, for "also attending"
	people?: Record<string, string>;
	slots: ClassSlot[];
	// Omit for no weekly limit (book the next matching classes up to maxTotalSessions).
	maxSessionsPerWeek?: number;
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
	alsoAttending: string[];
	rebooked: boolean;
};

function getTimePartsInZone(
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

function weekdayForDate(year: number, month: number, day: number): number {
	return new Date(year, month - 1, day).getDay();
}

function getISOWeekNumber(year: number, month: number, day: number): number {
	const date = new Date(year, month - 1, day);
	date.setHours(0, 0, 0, 0);
	date.setDate(date.getDate() + 4 - (date.getDay() || 7));
	const yearStart = new Date(date.getFullYear(), 0, 1);
	return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getWeekKey(timestampMs: number, timeZone: string): string {
	const { year, month, day } = getTimePartsInZone(timestampMs, timeZone);
	const week = getISOWeekNumber(year, month, day);
	return `${year}-W${String(week).padStart(2, "0")}`;
}

function isTargetClass(cls: ClazzMobile, targetTitle: string): boolean {
	const target = targetTitle.trim().toUpperCase();
	const title = cls.title?.trim().toUpperCase();
	const type = cls.type?.trim().toUpperCase();
	return title === target || type === target;
}

function matchingSlot(
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
function danishDateLabel(timestampMs: number, timeZone: string): string {
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

function occupancyLabel(
	count: number | undefined,
	max: number | undefined,
): string {
	return count !== undefined && max !== undefined ? ` (${count}/${max})` : "";
}

/** Danish one-line summary of a booking, as used in notifications. */
export function formatBookedDa(booked: BookedClass): string {
	const waiting = booked.waitingList ? " (VENTELISTE)" : "";
	const tracked =
		booked.alsoAttending.length > 0
			? `\nDeltager også: ${booked.alsoAttending.join(", ")}`
			: "";
	return `${booked.timeLabel} - ${booked.labelDa}${booked.occupancy}${waiting}${tracked}`;
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
	people = {},
	slots,
	maxSessionsPerWeek = Number.POSITIVE_INFINITY,
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

	// Weekly counts use all held bookings (so earlier-this-week sessions still count).
	const bookingsByWeek = new Map<string, number>();
	for (const b of held) {
		const key = getWeekKey(b.ms, centerTimeZone);
		bookingsByWeek.set(key, (bookingsByWeek.get(key) ?? 0) + 1);
	}

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
		.sort((a, b) =>
			Number(pendingRebooks.has(b.cls.id)) - Number(pendingRebooks.has(a.cls.id)) ||
			a.ms - b.ms,
		);

	const newlyBooked: BookedClass[] = [];

	for (const { cls, ms, slot } of candidates) {
		if (upcomingCount >= maxTotalSessions) break;
		if (heldClassIds.has(cls.id)) continue;
		if (skipped.has(cls.id)) continue;
		const rebookRequested = pendingRebooks.has(cls.id);
		if (registeredClassIds.has(cls.id) && !rebookRequested) continue;

		const weekKey = getWeekKey(ms, centerTimeZone);
		if ((bookingsByWeek.get(weekKey) ?? 0) >= maxSessionsPerWeek) continue;

		const timeLabel = `${slot.classTitle} ${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`;
		const labelEn = dateLabel(ms, centerTimeZone, "en-GB");
		const labelDa = dateLabel(ms, centerTimeZone, "da-DK");

		if (dryRun) {
			const occ = occupancyLabel(
				cls.numberOfParticipants,
				cls.maximumNumberOfParticipants,
			);
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
				alsoAttending: [],
				rebooked: rebookRequested,
			});
			upcomingCount++;
			registeredClassIds.add(cls.id);
			heldClassIds.add(cls.id);
			bookingsByWeek.set(weekKey, (bookingsByWeek.get(weekKey) ?? 0) + 1);
			continue;
		}

		log(`${rebookRequested ? "Rebooking" : "Booking"}: ${timeLabel} on ${labelEn}`);
		const cancelled = rebookRequested
			? bookings.find(
					(b) => b.classId === cls.id && CANCELLED_STATUSES.has(b.status),
				)
			: undefined;
		if (cancelled) {
			try {
				await reactivateBooking(token, {
					participationId: cancelled.id,
					classHourId: cls.id,
					accountId,
				});
			} catch (error) {
				// The API can remove an opted-out participation when a PUT fails.
				// Re-read before deciding whether a new POST is needed.
				const current = await getMyBookings(token, accountId);
				if (!current.some((b) => b.classId === cls.id)) {
					await bookClass(token, { classHourId: cls.id, accountId });
				} else if (
					!current.some(
						(b) => b.classId === cls.id && !CANCELLED_STATUSES.has(b.status),
					)
				) {
					throw error;
				}
			}
		} else {
			await bookClass(token, { classHourId: cls.id, accountId });
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

		// Occupancy + "also attending" from the class detail (post-booking).
		let trackedHere: string[] = [];
		let occ = "";
		try {
			const detail = await getClassDetail(token, cls.id);
			occ = occupancyLabel(
				detail.numberOfParticipants,
				detail.maximumNumberOfParticipants,
			);
			trackedHere = (detail.participants ?? [])
				.filter((p) => people[String(p.participantId)])
				.map((p) => people[String(p.participantId)] as string)
				.sort();
		} catch {
			// Detail is best-effort; booking already succeeded and verified.
		}

		const consoleTracked =
			trackedHere.length > 0
				? ` - also attending: ${trackedHere.join(", ")}`
				: "";

		log(
			`Booked and verified: ${timeLabel} on ${labelEn}${occ}${onWaitingList ? " (WAITING LIST)" : ""}${consoleTracked}`,
		);
		newlyBooked.push({
			classId: cls.id,
			begins: cls.begins,
			timeLabel,
			labelEn,
			labelDa,
			occupancy: occ,
			waitingList: onWaitingList,
			alsoAttending: trackedHere,
			rebooked: rebookRequested,
		});

		upcomingCount++;
		registeredClassIds.add(cls.id);
		heldClassIds.add(cls.id);
		bookingsByWeek.set(weekKey, (bookingsByWeek.get(weekKey) ?? 0) + 1);
	}

	if (newlyBooked.length === 0) {
		log("No new sessions booked.");
	}

	return newlyBooked;
}
