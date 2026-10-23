import type { ClassRegistration } from "../types.ts";
import { getTimePartsInZone } from "./bookingAutomation.ts";

// Past classes come back as OnTime once checked in. A past SignedUp hasn't been
// checked in (yet), but the member was there as far as we know.
const ATTENDED_STATUSES = new Set(["OnTime", "SignedUp"]);
const HEATMAP_WEEKS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PersonalStats = {
	attended: number;
	// Earliest registration the API returned (its history doesn't go back forever)
	since?: string;
	thisMonth: number;
	lastMonth: number;
	hoursTrained: number;
	upcoming: number;
	currentStreakWeeks: number;
	longestStreakWeeks: number;
	// Attended classes per weekday, Monday first
	weekdays: number[];
	timeOfDay: { morning: number; midday: number; evening: number };
	favouriteClass?: { title: string; count: number };
	favouriteTime?: { time: string; count: number };
	bestMonth?: { year: number; month: number; count: number };
	noShows: number;
	lateCancellations: number;
	cancellations: number;
	// Average days between signing up and the class, for classes attended
	averageLeadDays?: number;
	// Attended classes per day, HEATMAP_WEEKS full weeks ending with the current one,
	// Monday first; days after today are null.
	heatmap: (number | null)[];
	// The heatmap's first day (a Monday), "YYYY-MM-DD"
	heatmapStart: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Days since 1970-01-01 of the local calendar date in the time zone. */
function localDay(ms: number, timeZone: string): number {
	const { year, month, day } = getTimePartsInZone(ms, timeZone);
	return Date.UTC(year, month - 1, day) / DAY_MS;
}

// Day 0 (1970-01-01) was a Thursday, so weeks start on Monday at day -3.
const weekOf = (day: number) => Math.floor((day + 3) / 7);
const mondayIndex = (day: number) => (day + 3) % 7;

function mostCommon<T>(counts: Map<T, number>): [T, number] | undefined {
	let best: [T, number] | undefined;
	for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
	return best;
}

function increment<T>(counts: Map<T, number>, key: T): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Longest run of consecutive numbers in a set, and the run ending at `end`. */
function streaks(weeks: Set<number>, end: number) {
	let longest = 0;
	for (const week of weeks) {
		if (weeks.has(week - 1)) continue;
		let length = 1;
		while (weeks.has(week + length)) length++;
		longest = Math.max(longest, length);
	}
	let current = 0;
	while (weeks.has(end - current)) current++;
	return { longest, current };
}

export function computePersonalStats(
	registrations: ClassRegistration[],
	nowMs: number,
	timeZone: string,
): PersonalStats {
	const today = localDay(nowMs, timeZone);
	const now = getTimePartsInZone(nowMs, timeZone);
	const lastMonthDate =
		now.month === 1
			? { year: now.year - 1, month: 12 }
			: { year: now.year, month: now.month - 1 };

	const weekdays = [0, 0, 0, 0, 0, 0, 0];
	const timeOfDay = { morning: 0, midday: 0, evening: 0 };
	const classes = new Map<string, number>();
	const times = new Map<string, number>();
	const months = new Map<string, number>();
	const days = new Map<number, number>();
	const weeks = new Set<number>();
	const leadDays: number[] = [];
	const stats = {
		attended: 0,
		thisMonth: 0,
		lastMonth: 0,
		hoursTrained: 0,
		upcoming: 0,
		noShows: 0,
		lateCancellations: 0,
		cancellations: 0,
	};
	let since: number | undefined;

	for (const r of registrations) {
		const begins = Date.parse(r.begins);
		if (!Number.isFinite(begins)) continue;
		since = Math.min(since ?? begins, begins);
		if (begins > nowMs) {
			if (r.status === "SignedUp" || r.status === "OnWaitingList")
				stats.upcoming++;
			continue;
		}
		if (r.status === "NeverMet") stats.noShows++;
		if (r.status === "OptedOutTooLate") stats.lateCancellations++;
		if (r.status === "OptedOut") stats.cancellations++;
		if (!ATTENDED_STATUSES.has(r.status)) continue;

		const parts = getTimePartsInZone(begins, timeZone);
		const day = localDay(begins, timeZone);
		stats.attended++;
		if (parts.year === now.year && parts.month === now.month) stats.thisMonth++;
		if (
			parts.year === lastMonthDate.year &&
			parts.month === lastMonthDate.month
		)
			stats.lastMonth++;
		const ends = Date.parse(r.ends ?? "");
		stats.hoursTrained += Number.isFinite(ends)
			? (ends - begins) / 3_600_000
			: 1;

		weekdays[mondayIndex(day)]++;
		const minutes = parts.hour * 60 + parts.minute;
		if (minutes < 10 * 60) timeOfDay.morning++;
		else if (minutes < 15 * 60) timeOfDay.midday++;
		else timeOfDay.evening++;
		increment(classes, r.className);
		increment(times, `${pad(parts.hour)}:${pad(parts.minute)}`);
		increment(months, `${parts.year}-${parts.month}`);
		increment(days, day);
		weeks.add(weekOf(day));

		const signedUp = Date.parse(r.signedUpAt ?? "");
		if (Number.isFinite(signedUp) && signedUp < begins)
			leadDays.push((begins - signedUp) / DAY_MS);
	}

	// A week without a class yet doesn't break the streak until it's over.
	const thisWeek = weekOf(today);
	const { longest, current } = streaks(
		weeks,
		weeks.has(thisWeek) ? thisWeek : thisWeek - 1,
	);

	const firstHeatmapDay = (thisWeek - HEATMAP_WEEKS + 1) * 7 - 3;
	const heatmap = Array.from({ length: HEATMAP_WEEKS * 7 }, (_, i) => {
		const day = firstHeatmapDay + i;
		return day > today ? null : (days.get(day) ?? 0);
	});

	const favouriteClass = mostCommon(classes);
	const favouriteTime = mostCommon(times);
	const bestMonth = mostCommon(months);

	return {
		...stats,
		hoursTrained: Math.round(stats.hoursTrained),
		since: since === undefined ? undefined : new Date(since).toISOString(),
		currentStreakWeeks: current,
		longestStreakWeeks: longest,
		weekdays,
		timeOfDay,
		favouriteClass: favouriteClass && {
			title: favouriteClass[0],
			count: favouriteClass[1],
		},
		favouriteTime: favouriteTime && {
			time: favouriteTime[0],
			count: favouriteTime[1],
		},
		bestMonth: bestMonth && {
			year: Number(bestMonth[0].split("-")[0]),
			month: Number(bestMonth[0].split("-")[1]),
			count: bestMonth[1],
		},
		averageLeadDays:
			leadDays.length > 0
				? Math.round(
						(leadDays.reduce((sum, d) => sum + d, 0) / leadDays.length) * 10,
					) / 10
				: undefined,
		heatmap,
		heatmapStart: new Date(firstHeatmapDay * DAY_MS).toISOString().slice(0, 10),
	};
}
