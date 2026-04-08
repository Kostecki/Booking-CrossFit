import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RawUserBooking } from "../types.ts";
import { createBookingKey } from "./bookingKey.ts";
import { parseDotNetDate } from "./dotNetDate.ts";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const GYM_ADDRESS = "Rådmandshaven 4B, 4000 Roskilde";

export type CalendarSyncConfig = {
	calendarIcsFile: string;
	calendarLookbackDays: number;
	calendarOwnerKey: string;
	instructorsByBookingKey?: Map<string, string>;
	reminderMinutesBeforeStart?: number;
};

function formatUtc(ms: number): string {
	const date = new Date(ms);
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hour = String(date.getUTCHours()).padStart(2, "0");
	const minute = String(date.getUTCMinutes()).padStart(2, "0");
	const second = String(date.getUTCSeconds()).padStart(2, "0");

	return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function escapeIcsText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\r?\n/g, "\\n")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,");
}

function foldIcsLine(line: string, maxLength = 74): string {
	if (line.length <= maxLength) {
		return line;
	}

	const chunks: string[] = [];
	let i = 0;

	while (i < line.length) {
		const chunk = line.slice(i, i + maxLength);
		chunks.push(i === 0 ? chunk : ` ${chunk}`);
		i += maxLength;
	}

	return chunks.join("\r\n");
}

function sanitizeDurationSeconds(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 3600;
	}

	return Math.floor(value);
}

function isWaitlistBooking(booking: RawUserBooking): boolean {
	return booking.Capacity > 0 && booking.NumberOnList > booking.Capacity;
}

function toIcsEvent(
	booking: RawUserBooking,
	nowMs: number,
	calendarOwnerKey: string,
	instructorsByBookingKey: Map<string, string>,
	reminderMinutesBeforeStart: number,
): string | null {
	const startMs = parseDotNetDate(booking.StartDateTime);
	if (startMs === null) {
		return null;
	}

	const durationSeconds = sanitizeDurationSeconds(booking.Duration);
	const endMs = startMs + durationSeconds * 1000;
	const isWaitlist = isWaitlistBooking(booking);
	const uid = `${booking.RessourceId}-${startMs}-${calendarOwnerKey}@booking-crossfit`;
	const bookingKey = createBookingKey(booking.RessourceId, startMs);
	const instructors = instructorsByBookingKey.get(bookingKey)?.trim() || "??";
	const summary = escapeIcsText(booking.Name || "Booked Session");
	const instructorLine = `Instruktør: ${instructors}`;
	const waitlistLine = isWaitlist
		? `Venteliste position: ${booking.NumberOnList - booking.Capacity}`
		: "";
	const descriptionParts = [instructorLine, waitlistLine].filter(
		(part): part is string => Boolean(part?.trim()),
	);
	const description =
		descriptionParts.length > 0
			? escapeIcsText(descriptionParts.join("\n"))
			: null;

	const lines = [
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTAMP:${formatUtc(nowMs)}`,
		`DTSTART:${formatUtc(startMs)}`,
		`DTEND:${formatUtc(endMs)}`,
		`SUMMARY:${summary}`,
		`LOCATION:${escapeIcsText(GYM_ADDRESS)}`,
		description ? `DESCRIPTION:${description}` : null,
		...(reminderMinutesBeforeStart > 0
			? [
					"BEGIN:VALARM",
					"ACTION:DISPLAY",
					`DESCRIPTION:${escapeIcsText(`Reminder: ${booking.Name || "Booked Session"}`)}`,
					`TRIGGER:-PT${Math.floor(reminderMinutesBeforeStart)}M`,
					"END:VALARM",
				]
			: []),
		"END:VEVENT",
	].filter((line): line is string => Boolean(line));

	return lines.map((line) => foldIcsLine(line)).join("\r\n");
}

function buildIcsCalendar(
	bookings: RawUserBooking[],
	calendarOwnerKey: string,
	instructorsByBookingKey: Map<string, string>,
	reminderMinutesBeforeStart: number,
): string {
	const nowMs = Date.now();
	const events = bookings
		.map((booking) =>
			toIcsEvent(
				booking,
				nowMs,
				calendarOwnerKey,
				instructorsByBookingKey,
				reminderMinutesBeforeStart,
			),
		)
		.filter((event): event is string => Boolean(event));

	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//booking-crossfit//Booked Sessions//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"X-WR-CALNAME:CrossFit Bookings",
		...events,
		"END:VCALENDAR",
	];

	return `${lines.join("\r\n")}\r\n`;
}

async function writeFileAtomic(
	filePath: string,
	content: string,
): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });

	const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tempPath, content, "utf8");

	try {
		await rename(tempPath, filePath);
	} catch (error) {
		try {
			await rm(tempPath, { force: true });
		} catch {
			// Best effort cleanup only.
		}
		throw error;
	}
}

export async function syncCalendarFileFromBookings(
	bookings: RawUserBooking[],
	{
		calendarIcsFile,
		calendarLookbackDays,
		calendarOwnerKey,
		instructorsByBookingKey,
		reminderMinutesBeforeStart,
	}: CalendarSyncConfig,
): Promise<{
	updated: boolean;
	eventCount: number;
}> {
	const nowMs = Date.now();
	const lookbackStartMs = nowMs - calendarLookbackDays * ONE_DAY_MS;

	const relevantBookings = bookings
		.filter((booking) => {
			const startMs = parseDotNetDate(booking.StartDateTime);
			return startMs !== null && startMs >= lookbackStartMs;
		})
		.sort((a, b) => {
			const aMs = parseDotNetDate(a.StartDateTime) ?? 0;
			const bMs = parseDotNetDate(b.StartDateTime) ?? 0;
			return aMs - bMs;
		});

	const nextContent = buildIcsCalendar(
		relevantBookings,
		calendarOwnerKey,
		instructorsByBookingKey ?? new Map(),
		reminderMinutesBeforeStart ?? 60,
	);

	let currentContent: string | null = null;
	try {
		currentContent = await readFile(calendarIcsFile, "utf8");
	} catch (error) {
		const maybeNodeError = error as NodeJS.ErrnoException;
		if (maybeNodeError.code !== "ENOENT") {
			throw error;
		}
	}

	if (currentContent === nextContent) {
		return { updated: false, eventCount: relevantBookings.length };
	}

	await writeFileAtomic(calendarIcsFile, nextContent);

	return { updated: true, eventCount: relevantBookings.length };
}
