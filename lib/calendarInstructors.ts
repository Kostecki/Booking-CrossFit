import { getEventsForDay } from "../bookingApi.ts";
import type { RawUserBooking } from "../types.ts";
import { createBookingKey } from "./bookingKey.ts";
import { parseDotNetDate } from "./dotNetDate.ts";

type CalendarInstructorsConfig = {
	bookings: RawUserBooking[];
	centerId: number;
	username: string;
	password: string;
	centerTimeZone: string;
};

type EventWithInstructor = {
	RessourceId: number;
	StartDateTime: string;
	Instructors?: string;
};

function isEventWithInstructor(value: unknown): value is EventWithInstructor {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<EventWithInstructor>;
	return (
		typeof candidate.RessourceId === "number" &&
		typeof candidate.StartDateTime === "string"
	);
}

function getDayKey(timestampMs: number, timeZone: string): string {
	const date = new Date(timestampMs);
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});

	return formatter.format(date);
}

export async function buildInstructorsByBookingKey({
	bookings,
	centerId,
	username,
	password,
	centerTimeZone,
}: CalendarInstructorsConfig): Promise<Map<string, string>> {
	const dayToRepresentativeTimestamp = new Map<string, number>();

	for (const booking of bookings) {
		const startMs = parseDotNetDate(booking.StartDateTime);
		if (startMs === null) {
			continue;
		}

		const dayKey = getDayKey(startMs, centerTimeZone);
		if (!dayToRepresentativeTimestamp.has(dayKey)) {
			dayToRepresentativeTimestamp.set(dayKey, startMs);
		}
	}

	const instructorsByBookingKey = new Map<string, string>();

	for (const dayTimestampMs of dayToRepresentativeTimestamp.values()) {
		const dayEvents = await getEventsForDay({
			centerId,
			dayTimestampMs,
			username,
			password,
		});

		for (const event of dayEvents) {
			if (!isEventWithInstructor(event)) {
				continue;
			}

			const eventStartMs = parseDotNetDate(event.StartDateTime);
			if (eventStartMs === null) {
				continue;
			}

			const key = createBookingKey(event.RessourceId, eventStartMs);
			const instructors = event.Instructors?.trim();
			if (instructors) {
				instructorsByBookingKey.set(key, instructors);
			}
		}
	}

	return instructorsByBookingKey;
}
