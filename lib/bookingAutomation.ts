import {
	bookSession,
	getBookings,
	getEventsForDay,
	getSessionBookings,
} from "../bookingApi.ts";
import { loadBookingState, saveBookingState } from "./bookingState.ts";
import { parseDotNetDate } from "./dotNetDate.ts";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type EventItem = {
	RessourceId: number;
	StartDateTime: string;
	Title?: string;
	Name?: string;
	Text?: string;
	Capacity?: number;
	FreeSpace?: number;
};

export type BookingAutomationConfig = {
	username: string;
	password: string;
	centerId: number;
	centerTimeZone: string;
	people: Record<string, string>;
	targetWeekdays: number[];
	maxSessionsPerWeek: number;
	maxTotalSessions: number;
	maxScanDays: number;
	targetHour: number;
	targetMinute: number;
	stateFile: string;
};

function isEventItem(value: unknown): value is EventItem {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<EventItem>;
	return (
		typeof candidate.RessourceId === "number" &&
		typeof candidate.StartDateTime === "string"
	);
}

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

function isSameDayInZone(
	timestampMs: number,
	referenceMs: number,
	timeZone: string,
): boolean {
	const valueDay = getTimePartsInZone(timestampMs, timeZone);
	const refDay = getTimePartsInZone(referenceMs, timeZone);

	return (
		valueDay.year === refDay.year &&
		valueDay.month === refDay.month &&
		valueDay.day === refDay.day
	);
}

function isTargetTimeInZone(
	timestampMs: number,
	targetHour: number,
	targetMinute: number,
	timeZone: string,
): boolean {
	const valueTime = getTimePartsInZone(timestampMs, timeZone);
	return valueTime.hour === targetHour && valueTime.minute === targetMinute;
}

function isWodEvent(event: EventItem): boolean {
	const normalizedName = event.Name?.trim().toUpperCase();
	const normalizedText = event.Text?.trim().toUpperCase();
	const normalizedTitle = event.Title?.trim().toUpperCase();

	return (
		normalizedName === "WOD" ||
		normalizedText === "WOD" ||
		normalizedTitle?.startsWith("WOD ") === true
	);
}

function getISOWeekNumber(year: number, month: number, day: number): number {
	const date = new Date(year, month - 1, day);
	date.setHours(0, 0, 0, 0);
	date.setDate(date.getDate() + 4 - (date.getDay() || 7));
	const yearStart = new Date(date.getFullYear(), 0, 1);
	const weekNumber = Math.ceil(
		((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
	);
	return weekNumber;
}

function getWeekKey(year: number, week: number): string {
	return `${year}-W${String(week).padStart(2, "0")}`;
}

export async function runBookingAutomation({
	username,
	password,
	centerId,
	centerTimeZone,
	people,
	targetWeekdays,
	maxSessionsPerWeek,
	maxTotalSessions,
	maxScanDays,
	targetHour,
	targetMinute,
	stateFile,
}: BookingAutomationConfig): Promise<string[]> {
	const nowMs = Date.now();
	const runDate = new Date(nowMs).toLocaleDateString("en-GB", {
		timeZone: centerTimeZone,
	});
	console.log(`Today: ${runDate}\n`);
	console.log("");

	const existingBookings = await getBookings({ username, password });
	const futureBookings = existingBookings
		.map((b) => ({
			ms: parseDotNetDate(b.StartDateTime),
			name: b.Name,
			capacity: b.Capacity,
			numberOnList: b.NumberOnList,
		}))
		.filter(
			(
				b,
			): b is {
				ms: number;
				name: string;
				capacity: number;
				numberOnList: number;
			} => b.ms !== null && b.ms > nowMs,
		)
		.sort((a, b) => a.ms - b.ms);
	const futureBookedTimes = new Set(futureBookings.map((b) => b.ms));

	const bookedDateLabels = futureBookings.map((b) => {
		const date = new Date(b.ms).toLocaleDateString("en-GB", {
			timeZone: centerTimeZone,
			weekday: "long",
			day: "numeric",
			month: "long",
		});
		const occupancy = `(${b.numberOnList}/${b.capacity})`;
		return `${date} ${occupancy}`;
	});
	console.log(
		`Currently booked: ${futureBookedTimes.size}/${maxTotalSessions} sessions${
			bookedDateLabels.length > 0 ? `\n${bookedDateLabels.join("\n")}` : ""
		}\n`,
	);
	console.log("");

	// Build a map of bookings by week — merge future bookings from the API with
	// historical timestamps from the state file so past sessions in the current
	// week still count toward the per-week limit.
	const historicalTimestamps = await loadBookingState(stateFile);
	const futureTimestamps = [...futureBookedTimes];
	const allKnownTimestamps = [
		...new Set([...historicalTimestamps, ...futureTimestamps]),
	];

	const bookingsByWeek = new Map<string, number>();
	for (const ms of allKnownTimestamps) {
		const { year, month, day } = getTimePartsInZone(ms, centerTimeZone);
		const weekNumber = getISOWeekNumber(year, month, day);
		const weekKey = getWeekKey(year, weekNumber);
		bookingsByWeek.set(weekKey, (bookingsByWeek.get(weekKey) ?? 0) + 1);
	}

	const newlyBooked: string[] = [];

	for (let i = 0; i < maxScanDays; i++) {
		// Stop if we've reached max total sessions
		if (futureBookedTimes.size >= maxTotalSessions) {
			break;
		}

		const candidateMs = nowMs + i * ONE_DAY_MS;
		const { year, month, day } = getTimePartsInZone(
			candidateMs,
			centerTimeZone,
		);
		const weekday = new Date(year, month - 1, day).getDay();

		if (!targetWeekdays.includes(weekday)) {
			continue;
		}

		// Check if this week already has max sessions
		const weekNumber = getISOWeekNumber(year, month, day);
		const weekKey = getWeekKey(year, weekNumber);
		const sessionsInThisWeek = bookingsByWeek.get(weekKey) ?? 0;
		if (sessionsInThisWeek >= maxSessionsPerWeek) {
			continue;
		}

		const allEvents = await getEventsForDay({
			centerId,
			dayTimestampMs: candidateMs,
			username,
			password,
		});
		const dayEvents = allEvents.filter(isEventItem).filter((event) => {
			const ms = parseDotNetDate(event.StartDateTime);
			return ms !== null && isSameDayInZone(ms, candidateMs, centerTimeZone);
		});

		const targetEvent = dayEvents.find((event) => {
			const ms = parseDotNetDate(event.StartDateTime);

			return (
				ms !== null &&
				isTargetTimeInZone(ms, targetHour, targetMinute, centerTimeZone) &&
				isWodEvent(event)
			);
		});

		if (!targetEvent) {
			continue;
		}

		const sessionStartMs = parseDotNetDate(targetEvent.StartDateTime);
		if (sessionStartMs === null || futureBookedTimes.has(sessionStartMs)) {
			continue;
		}

		const dateLabel = new Date(sessionStartMs).toLocaleDateString("en-GB", {
			timeZone: centerTimeZone,
			weekday: "long",
			day: "numeric",
			month: "long",
		});
		const dateLabelDa = new Date(sessionStartMs).toLocaleDateString("da-DK", {
			timeZone: centerTimeZone,
			weekday: "long",
			day: "numeric",
			month: "long",
		});
		const bookedCount =
			targetEvent.Capacity !== undefined && targetEvent.FreeSpace !== undefined
				? targetEvent.Capacity - targetEvent.FreeSpace
				: null;
		const bookedCountLabel =
			bookedCount !== null && targetEvent.Capacity !== undefined
				? ` (${bookedCount}/${targetEvent.Capacity} booked)`
				: "";
		const sessionLabel = `WOD ${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")} on ${dateLabel}${bookedCountLabel}`;

		console.log(`Booking: ${sessionLabel}`);
		await bookSession({
			resourceId: targetEvent.RessourceId,
			sessionStartMs,
			username,
			password,
		});

		const updatedBookings = await getBookings({ username, password });
		const verified = updatedBookings.some(
			(b) => parseDotNetDate(b.StartDateTime) === sessionStartMs,
		);

		if (!verified) {
			throw new Error(`Booking verification failed for ${sessionLabel}`);
		}

		const allParticipants = await getSessionBookings({
			resourceId: targetEvent.RessourceId,
			sessionStartMs,
			username,
			password,
		});

		const updatedBookedCount = allParticipants.length;
		const updatedBookedCountLabel =
			targetEvent.Capacity !== undefined
				? ` (${updatedBookedCount}/${targetEvent.Capacity})`
				: "";

		const bookedSession = updatedBookings.find(
			(b) => parseDotNetDate(b.StartDateTime) === sessionStartMs,
		);
		const isWaitingList =
			bookedSession?.Capacity &&
			bookedSession.NumberOnList > bookedSession.Capacity;

		const trackedPeopleHere = allParticipants
			.filter((booking) => people[booking.userName])
			.map((booking) => people[booking.userName])
			.sort();

		const consoleLabel = `WOD ${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")} on ${dateLabel}${updatedBookedCountLabel}${isWaitingList ? " (WAITING LIST)" : ""}`;
		const consoleTracked =
			trackedPeopleHere.length > 0
				? ` - also attending: ${trackedPeopleHere.join(", ")}`
				: "";

		const pushoverLabel = `WOD ${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")} d. ${dateLabelDa}${updatedBookedCountLabel}${isWaitingList ? " (VENTELISTE)" : ""}`;
		const pushoverTracked =
			trackedPeopleHere.length > 0
				? `\n  Deltager også: ${trackedPeopleHere.join(", ")}`
				: "";

		// Update tracking
		futureBookedTimes.add(sessionStartMs);
		allKnownTimestamps.push(sessionStartMs);
		bookingsByWeek.set(weekKey, sessionsInThisWeek + 1);
		console.log(`Booked and verified: ${consoleLabel}${consoleTracked}`);
		newlyBooked.push(pushoverLabel + pushoverTracked);
	}

	await saveBookingState(stateFile, allKnownTimestamps);

	return newlyBooked;
}
