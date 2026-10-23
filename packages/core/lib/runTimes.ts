import { getTimePartsInZone } from "./bookingAutomation.ts";

// When the daily booking run starts, as "HH:MM" in the gym's time zone. Admins can
// change the list; this is what's used until they do.
export const DEFAULT_RUN_TIMES = ["19:00"];
export const MAX_RUN_TIMES = 4;
// A run takes up to ~30 min (start jitter, per-user pauses, one retry round).
export const MIN_RUN_GAP_MINUTES = 60;

const pad = (n: number) => String(n).padStart(2, "0");

const toMinutes = (time: string) => {
	const [hour, minute] = time.split(":").map(Number);
	return hour * 60 + minute;
};

/** "7:5" or "07:05" → "07:05"; undefined if it isn't a valid time of day. */
export function parseRunTime(value: string): string | undefined {
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return undefined;
	return `${pad(hour)}:${pad(minute)}`;
}

/**
 * Validate and normalize a list of run times: sorted, without duplicates, at least
 * MIN_RUN_GAP_MINUTES apart (also across midnight). Errors are Danish, for the UI.
 */
export function normalizeRunTimes(
	values: string[],
): { ok: true; times: string[] } | { ok: false; error: string } {
	const parsed = values.map(parseRunTime);
	if (parsed.some((time) => time === undefined)) {
		return { ok: false, error: "Ugyldigt tidspunkt (brug TT:MM)" };
	}
	const times = [...new Set(parsed as string[])].sort();
	if (times.length === 0) {
		return { ok: false, error: "Der skal være mindst ét tidspunkt" };
	}
	if (times.length > MAX_RUN_TIMES) {
		return { ok: false, error: `Højst ${MAX_RUN_TIMES} tidspunkter` };
	}
	const minutes = times.map(toMinutes);
	for (const [index, value] of minutes.entries()) {
		const next = minutes[(index + 1) % minutes.length];
		const gap = (next - value + 24 * 60) % (24 * 60);
		if (times.length > 1 && gap < MIN_RUN_GAP_MINUTES) {
			return {
				ok: false,
				error: `Tidspunkterne skal ligge mindst ${MIN_RUN_GAP_MINUTES} min fra hinanden`,
			};
		}
	}
	return { ok: true, times };
}

/** Cron pattern for a "HH:MM" run time, e.g. "0 19 * * *". */
export function runTimeCron(time: string): string {
	const [hour, minute] = time.split(":").map(Number);
	return `${minute} ${hour} * * *`;
}

/** "kl. 19:00", "kl. 07:00 og 19:00", "kl. 07:00, 12:00 og 19:00". */
export function formatRunTimes(times: string[]): string {
	if (times.length <= 1) return `kl. ${times[0] ?? ""}`;
	return `kl. ${times.slice(0, -1).join(", ")} og ${times.at(-1)}`;
}

/** "hver aften kl. 19:00" for a single evening run, otherwise "hver dag kl. …". */
export function runScheduleLabel(times: string[]): string {
	const evening = times.length === 1 && toMinutes(times[0]) >= 17 * 60;
	return `${evening ? "hver aften" : "hver dag"} ${formatRunTimes(times)}`;
}

/** When the next run starts: "i dag kl. 07:00", "i aften kl. 19:00", "i morgen kl. 07:00". */
export function nextRunLabel(
	times: string[],
	nowMs: number,
	timeZone: string,
): string {
	const { hour, minute } = getTimePartsInZone(nowMs, timeZone);
	const now = hour * 60 + minute;
	const today = times.find((time) => toMinutes(time) > now);
	if (today) {
		const evening = toMinutes(today) >= 17 * 60;
		return `${evening ? "i aften" : "i dag"} kl. ${today}`;
	}
	return `i morgen kl. ${times[0]}`;
}
