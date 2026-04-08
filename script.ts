import { getBookings, sendPushoverNotification } from "./bookingApi.ts";
import { runBookingAutomation } from "./lib/bookingAutomation.ts";
import { buildInstructorsByBookingKey } from "./lib/calendarInstructors.ts";
import { syncCalendarFileFromBookings } from "./lib/calendarSync.ts";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing required environment variable: ${name}`);
		process.exit(1);
	}
	return value;
}

const username = requireEnv("API_USERNAME");
const password = requireEnv("API_PASSWORD");
const PUSHOVER_TOKEN = requireEnv("PUSHOVER_TOKEN");
const PUSHOVER_USER = requireEnv("PUSHOVER_USER");

const centerId = Number(requireEnv("CENTER_ID"));
const centerTimeZone = "Europe/Copenhagen";
const people: Record<string, string> = JSON.parse(
	process.env.TRACKED_PEOPLE ?? "{}",
);

const TARGET_WEEKDAYS = [2, 4]; // 2=Tuesday, 4=Thursday (0=Sunday … 6=Saturday)
const TARGET_BOOKING_COUNT = 4;
const MAX_SCAN_DAYS = 60;
const DEFAULT_CALENDAR_LOOKBACK_DAYS = 14;
const TARGET_HOUR = 17;
const TARGET_MINUTE = 30;
const DEFAULT_CALENDAR_REMINDER_MINUTES = 60;

const calendarIcsFile = process.env.CALENDAR_ICS_FILE ?? "./bookings.ics";
const calendarLookbackDays = Number(
	process.env.CALENDAR_LOOKBACK_DAYS ?? DEFAULT_CALENDAR_LOOKBACK_DAYS,
);
const calendarReminderMinutes = Number(
	process.env.CALENDAR_REMINDER_MINUTES ?? DEFAULT_CALENDAR_REMINDER_MINUTES,
);

if (!Number.isFinite(calendarLookbackDays)) {
	console.error("Environment variable CALENDAR_LOOKBACK_DAYS must be a number");
	process.exit(1);
}

if (!Number.isFinite(calendarReminderMinutes) || calendarReminderMinutes < 0) {
	console.error(
		"Environment variable CALENDAR_REMINDER_MINUTES must be a non-negative number",
	);
	process.exit(1);
}

async function syncCalendarFileFromSourceOfTruth(): Promise<void> {
	const sourceBookings = await getBookings({ username, password });
	const instructorsByBookingKey = await buildInstructorsByBookingKey({
		bookings: sourceBookings,
		centerId,
		username,
		password,
		centerTimeZone,
	});

	const result = await syncCalendarFileFromBookings(sourceBookings, {
		calendarIcsFile,
		calendarLookbackDays,
		calendarOwnerKey: username,
		instructorsByBookingKey,
		reminderMinutesBeforeStart: calendarReminderMinutes,
	});

	if (result.updated) {
		console.log(
			`Calendar updated: ${calendarIcsFile} (${result.eventCount} events)`,
		);
		return;
	}

	console.log(
		`Calendar unchanged: ${calendarIcsFile} (${result.eventCount} events)`,
	);
}

async function main() {
	const newlyBooked = await runBookingAutomation({
		username,
		password,
		centerId,
		centerTimeZone,
		people,
		targetWeekdays: TARGET_WEEKDAYS,
		targetBookingCount: TARGET_BOOKING_COUNT,
		maxScanDays: MAX_SCAN_DAYS,
		targetHour: TARGET_HOUR,
		targetMinute: TARGET_MINUTE,
	});

	if (newlyBooked.length > 0) {
		const trainingWord = newlyBooked.length === 1 ? "træning" : "træninger";

		await sendPushoverNotification({
			token: PUSHOVER_TOKEN,
			user: PUSHOVER_USER,
			title: "CrossFit Bookinger",
			message: `Booket ${newlyBooked.length} ${trainingWord}:\n${newlyBooked.join("\n")}`,
		});
	}

	await syncCalendarFileFromSourceOfTruth();
}

async function run(): Promise<void> {
	try {
		await main();
	} catch (error) {
		console.error(error);

		try {
			await syncCalendarFileFromSourceOfTruth();
		} catch (syncError) {
			console.error("Failed to update calendar file after error:", syncError);
		}

		try {
			await sendPushoverNotification({
				token: PUSHOVER_TOKEN,
				user: PUSHOVER_USER,
				title: "CrossFit booking fejl",
				message: `Fejl: ${String(error)}`,
			});
		} catch {
			// Ignore secondary notification failures.
		}
	}
}

await run();
