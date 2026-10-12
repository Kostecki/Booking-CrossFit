import {
	bookClass,
	getClassDetail,
	getClasses,
	getMyBookings,
	toApiDateTime,
} from "../bookingApi.ts";
import type { ClazzMobile } from "../types.ts";

// Statuses that mean the booking no longer counts (cancelled / opted out).
const CANCELLED_STATUSES = new Set(["OptedOut", "OptedOutTooLate"]);

export type BookingAutomationConfig = {
	token: string;
	accountId: number;
	centerTimeZone: string;
	// participantId (as string) -> display name, for "also attending"
	people: Record<string, string>;
	classTitle: string;
	targetWeekdays: number[];
	maxSessionsPerWeek: number;
	maxTotalSessions: number;
	targetHour: number;
	targetMinute: number;
	dryRun: boolean;
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

function isTargetTimeInZone(
	timestampMs: number,
	targetHour: number,
	targetMinute: number,
	timeZone: string,
): boolean {
	const t = getTimePartsInZone(timestampMs, timeZone);
	return t.hour === targetHour && t.minute === targetMinute;
}

function weekdayForDate(year: number, month: number, day: number): number {
	return new Date(year, month - 1, day).getDay();
}

function getISOWeekNumber(year: number, month: number, day: number): number {
	const date = new Date(year, month - 1, day);
	date.setHours(0, 0, 0, 0);
	date.setDate(date.getDate() + 4 - (date.getDay() || 7));
	const yearStart = new Date(date.getFullYear(), 0, 1);
	return Math.ceil(
		((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
	);
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

function dateLabel(
	timestampMs: number,
	timeZone: string,
	locale: string,
): string {
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

export async function runBookingAutomation({
	token,
	accountId,
	centerTimeZone,
	people,
	classTitle,
	targetWeekdays,
	maxSessionsPerWeek,
	maxTotalSessions,
	targetHour,
	targetMinute,
	dryRun,
}: BookingAutomationConfig): Promise<string[]> {
	const nowMs = Date.now();
	const runDate = new Date(nowMs).toLocaleDateString("en-GB", {
		timeZone: centerTimeZone,
	});
	console.log(`Today: ${runDate}${dryRun ? "  (DRY RUN)" : ""}\n`);

	// --- Current bookings (past + future) come straight from the account ---
	const bookings = await getMyBookings(token, accountId);
	const held = bookings
		.filter((b) => !CANCELLED_STATUSES.has(b.status))
		.map((b) => ({ ...b, ms: Date.parse(b.begins) }))
		.filter((b) => Number.isFinite(b.ms));

	const upcoming = held
		.filter((b) => b.ms > nowMs)
		.sort((a, b) => a.ms - b.ms);
	const upcomingClassIds = new Set(upcoming.map((b) => b.classId));

	// Weekly counts use all held bookings (so earlier-this-week sessions still count).
	const bookingsByWeek = new Map<string, number>();
	for (const b of held) {
		const key = getWeekKey(b.ms, centerTimeZone);
		bookingsByWeek.set(key, (bookingsByWeek.get(key) ?? 0) + 1);
	}

	const bookedLabels = upcoming.map((b) =>
		dateLabel(b.ms, centerTimeZone, "en-GB"),
	);
	console.log(
		`Currently booked (upcoming): ${upcoming.length}/${maxTotalSessions}` +
			(bookedLabels.length > 0 ? `\n${bookedLabels.join("\n")}` : "") +
			"\n",
	);

	let upcomingCount = upcoming.length;
	if (upcomingCount >= maxTotalSessions) {
		console.log(
			`Already at the target of ${maxTotalSessions} booked sessions — nothing to do.`,
		);
		return [];
	}

	// --- One call returns the whole bookable window ---
	const start = getTimePartsInZone(nowMs, centerTimeZone);
	const startIso = toApiDateTime(start.year, start.month, start.day);
	const classes = await getClasses(token, startIso);

	// Candidate target sessions: WOD, at the target time, on a target weekday, in the future.
	const candidates = classes
		.map((cls) => ({ cls, ms: Date.parse(cls.begins) }))
		.filter(
			({ cls, ms }) =>
				Number.isFinite(ms) &&
				ms > nowMs &&
				isTargetClass(cls, classTitle) &&
				isTargetTimeInZone(ms, targetHour, targetMinute, centerTimeZone),
		)
		.filter(({ ms }) => {
			const { year, month, day } = getTimePartsInZone(ms, centerTimeZone);
			return targetWeekdays.includes(weekdayForDate(year, month, day));
		})
		.sort((a, b) => a.ms - b.ms);

	const timeLabel = `${classTitle} ${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")}`;
	const newlyBooked: string[] = [];

	for (const { cls, ms } of candidates) {
		if (upcomingCount >= maxTotalSessions) break;
		if (upcomingClassIds.has(cls.id)) continue; // already booked

		const weekKey = getWeekKey(ms, centerTimeZone);
		if ((bookingsByWeek.get(weekKey) ?? 0) >= maxSessionsPerWeek) continue;

		const labelEn = dateLabel(ms, centerTimeZone, "en-GB");
		const labelDa = dateLabel(ms, centerTimeZone, "da-DK");

		if (dryRun) {
			const occ = occupancyLabel(
				cls.numberOfParticipants,
				cls.maximumNumberOfParticipants,
			);
			const full = cls.hasSeatsLeft === false;
			console.log(
				`[dry-run] Would book: ${timeLabel} on ${labelEn}${occ}${full ? " (WAITING LIST)" : ""}`,
			);
			newlyBooked.push(
				`${timeLabel} d. ${labelDa}${occ}${full ? " (VENTELISTE)" : ""}`,
			);
			upcomingCount++;
			upcomingClassIds.add(cls.id);
			bookingsByWeek.set(weekKey, (bookingsByWeek.get(weekKey) ?? 0) + 1);
			continue;
		}

		console.log(`Booking: ${timeLabel} on ${labelEn}`);
		const booking = await bookClass(token, {
			classHourId: cls.id,
			accountId,
		});

		// Verify by re-reading the account's bookings.
		const updated = await getMyBookings(token, accountId);
		const verified = updated.some(
			(b) => b.classId === cls.id && !CANCELLED_STATUSES.has(b.status),
		);
		if (!verified) {
			throw new Error(
				`Booking verification failed for ${timeLabel} on ${labelEn}`,
			);
		}

		const onWaitingList = booking.status !== "SignedUp";

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
		const pushoverTracked =
			trackedHere.length > 0
				? `\n  Deltager også: ${trackedHere.join(", ")}`
				: "";

		console.log(
			`Booked and verified: ${timeLabel} on ${labelEn}${occ}${onWaitingList ? " (WAITING LIST)" : ""}${consoleTracked}`,
		);
		newlyBooked.push(
			`${timeLabel} d. ${labelDa}${occ}${onWaitingList ? " (VENTELISTE)" : ""}${pushoverTracked}`,
		);

		upcomingCount++;
		upcomingClassIds.add(cls.id);
		bookingsByWeek.set(weekKey, (bookingsByWeek.get(weekKey) ?? 0) + 1);
	}

	if (newlyBooked.length === 0) {
		console.log("No new sessions booked.");
	}

	return newlyBooked;
}
