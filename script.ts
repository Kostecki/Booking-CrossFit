import { getAccount, login, sendPushoverNotification } from "./bookingApi.ts";
import { runBookingAutomation } from "./lib/bookingAutomation.ts";

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

const centerTimeZone = "Europe/Copenhagen";
const people: Record<string, string> = JSON.parse(
	process.env.TRACKED_PEOPLE ?? "{}",
);
const dryRun = ["1", "true", "yes"].includes(
	(process.env.DRY_RUN ?? "").toLowerCase(),
);

const TARGET_WEEKDAYS = [2, 4]; // 2=Tuesday, 4=Thursday (0=Sunday … 6=Saturday)
const MAX_SESSIONS_PER_WEEK = 2;
const MAX_TOTAL_SESSIONS = 5; // keep 5 upcoming booked (gym's concurrent-booking cap)
const TARGET_HOUR = 17;
const TARGET_MINUTE = 30;

if (!Number.isFinite(chainId)) {
	console.error("Environment variable CHAIN_ID must be a number");
	process.exit(1);
}

async function main(): Promise<void> {
	const token = await login({ email, password, chainId });
	const account = await getAccount(token);
	console.log(`Logged in as ${account.fullName} (accountId ${account.id})\n`);

	const newlyBooked = await runBookingAutomation({
		token,
		accountId: account.id,
		centerTimeZone,
		people,
		targetWeekdays: TARGET_WEEKDAYS,
		maxSessionsPerWeek: MAX_SESSIONS_PER_WEEK,
		maxTotalSessions: MAX_TOTAL_SESSIONS,
		targetHour: TARGET_HOUR,
		targetMinute: TARGET_MINUTE,
		dryRun,
	});

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
