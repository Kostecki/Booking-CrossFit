import { readFile, writeFile } from "node:fs/promises";
import { getAccount, getMyBookings, login, sendPushoverNotification } from "./bookingApi.ts";
import { runBookingAutomation } from "./lib/bookingAutomation.ts";

const bookingStateFile = new URL("./rebook-state.json", import.meta.url);
const bookingRequestsFile = new URL("./booking-requests.json", import.meta.url);

async function readClassIds(file: URL, key: string): Promise<number[]> {
	let content: string;
	try {
		content = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const state: unknown = JSON.parse(content);
	const ids =
		typeof state === "object" && state !== null
			? (state as Record<string, unknown>)[key]
			: undefined;
	if (
		!Array.isArray(ids) ||
		!ids.every(
			(id: unknown) => Number.isSafeInteger(id) && Number(id) > 0,
		)
	) {
		throw new Error(`${file.pathname} must contain ${key} as positive class IDs`);
	}
	return ids as number[];
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing required environment variable: ${name}`);
		process.exit(1);
	}
	return value;
}

const email = requireEnv("API_EMAIL");
const password = requireEnv("API_PASSWORD");
const chainId = Number(requireEnv("CHAIN_ID"));
const PUSHOVER_TOKEN = requireEnv("PUSHOVER_TOKEN");
const PUSHOVER_USER = requireEnv("PUSHOVER_USER");

if (!Number.isFinite(chainId)) {
	console.error("Environment variable CHAIN_ID must be a number");
	process.exit(1);
}

function intEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		console.error(`Environment variable ${name} must be a non-negative integer`);
		process.exit(1);
	}
	return value;
}

function weekdaysEnv(name: string, fallback: number[]): number[] {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const days = raw.split(",").map((part) => Number(part.trim()));
	if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
		console.error(
			`Environment variable ${name} must be comma-separated weekday numbers 0-6 (0=Sunday)`,
		);
		process.exit(1);
	}
	return days;
}

function timeEnv(
	name: string,
	fallback: { hour: number; minute: number },
): { hour: number; minute: number } {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
	const hour = match ? Number(match[1]) : Number.NaN;
	const minute = match ? Number(match[2]) : Number.NaN;
	if (!match || hour > 23 || minute > 59) {
		console.error(`Environment variable ${name} must be a 24-hour time (HH:MM)`);
		process.exit(1);
	}
	return { hour, minute };
}

const centerTimeZone = process.env.TIME_ZONE || "Europe/Copenhagen";
const classTitle = process.env.CLASS_TITLE || "WOD";
const people: Record<string, string> = JSON.parse(
	process.env.TRACKED_PEOPLE ?? "{}",
);
const dryRun = ["1", "true", "yes"].includes(
	(process.env.DRY_RUN ?? "").toLowerCase(),
);

// Booking policy — all overridable via .env (defaults keep the original behaviour).
const targetWeekdays = weekdaysEnv("TARGET_WEEKDAYS", [2, 4]); // 2=Tue, 4=Thu (0=Sun … 6=Sat)
const { hour: targetHour, minute: targetMinute } = timeEnv("TARGET_TIME", {
	hour: 17,
	minute: 30,
});
const maxSessionsPerWeek = intEnv("MAX_SESSIONS_PER_WEEK", 2);
const maxTotalSessions = intEnv("MAX_TOTAL_SESSIONS", 5); // gym's concurrent-booking cap

async function main(): Promise<void> {
	const token = await login({ email, password, chainId });
	const account = await getAccount(token);
	const requestedRebookClassIds = await readClassIds(
		bookingRequestsFile,
		"rebookOnceClassIds",
	);
	const completedRebookClassIds = await readClassIds(
		bookingStateFile,
		"completedRebookClassIds",
	);
	const completedRebooks = new Set(completedRebookClassIds);
	const pendingRebookClassIds = requestedRebookClassIds.filter(
		(id) => !completedRebooks.has(id),
	);
	console.log(`Logged in as ${account.fullName} (accountId ${account.id})\n`);

	const newlyBooked = await runBookingAutomation({
		token,
		accountId: account.id,
		centerTimeZone,
		people,
		classTitle,
		targetWeekdays,
		maxSessionsPerWeek,
		maxTotalSessions,
		targetHour,
		targetMinute,
		dryRun,
		pendingRebookClassIds,
	});

	if (!dryRun && pendingRebookClassIds.length > 0) {
		const current = await getMyBookings(token, account.id);
		const newlyCompleted = pendingRebookClassIds.filter(
			(classId) =>
				current.some(
					(b) =>
						b.classId === classId &&
						b.status !== "OptedOut" &&
						b.status !== "OptedOutTooLate",
				),
		);
		if (newlyCompleted.length > 0) {
			await writeFile(
				bookingStateFile,
				`${JSON.stringify({ completedRebookClassIds: [...completedRebooks, ...newlyCompleted] }, null, 2)}\n`,
			);
		}
	}

	if (newlyBooked.length > 0 && !dryRun) {
		const trainingWord = newlyBooked.length === 1 ? "træning" : "træninger";

		await sendPushoverNotification({
			token: PUSHOVER_TOKEN,
			user: PUSHOVER_USER,
			title: "CrossFit Bookinger",
			message: `Booket ${newlyBooked.length} ${trainingWord}:\n${newlyBooked.join("\n")}`,
		});
	}
}

async function run(): Promise<void> {
	try {
		await main();
	} catch (error) {
		console.error(error);

		try {
			if (!dryRun) {
				await sendPushoverNotification({
					token: PUSHOVER_TOKEN,
					user: PUSHOVER_USER,
					title: "CrossFit booking fejl",
					message: `Fejl: ${String(error)}`,
				});
			}
		} catch {
			// Ignore secondary notification failures.
		}

		process.exitCode = 1;
	}
}

await run();
