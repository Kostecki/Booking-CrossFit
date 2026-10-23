import assert from "node:assert/strict";
import { test } from "node:test";

import { computePersonalStats } from "../lib/stats.ts";
import type { ClassRegistration } from "../types.ts";

const TZ = "Europe/Copenhagen";
// Friday 23 October 2026, noon
const NOW = Date.parse("2026-10-23T12:00:00+02:00");

let nextId = 1;
const reg = (
	begins: string,
	status: string,
	extra: Partial<ClassRegistration> = {},
): ClassRegistration => ({
	id: nextId,
	classId: nextId++,
	className: "WOD",
	begins,
	ends: new Date(Date.parse(begins) + 60 * 60_000).toISOString(),
	status,
	...extra,
});

test("counts attendance, cancellations and upcoming classes", () => {
	const stats = computePersonalStats(
		[
			reg("2026-10-20T17:30:00+02:00", "OnTime", {
				signedUpAt: "2026-10-18T17:30:00+02:00",
			}),
			reg("2026-10-22T06:00:00+02:00", "OnTime", {
				signedUpAt: "2026-10-21T06:00:00+02:00",
			}),
			reg("2026-09-29T17:30:00+02:00", "OnTime", {
				className: "Weightlifting",
			}),
			reg("2026-09-30T17:30:00+02:00", "NeverMet"),
			reg("2026-10-01T17:30:00+02:00", "OptedOutTooLate"),
			reg("2026-10-02T17:30:00+02:00", "OptedOut"),
			reg("2026-10-27T17:30:00+01:00", "SignedUp"),
			reg("2026-10-29T17:30:00+01:00", "OnWaitingList"),
			reg("2026-10-30T17:30:00+01:00", "OptedOut"),
		],
		NOW,
		TZ,
	);
	assert.equal(stats.attended, 3);
	assert.equal(stats.thisMonth, 2);
	assert.equal(stats.lastMonth, 1);
	assert.equal(stats.hoursTrained, 3);
	assert.equal(stats.upcoming, 2);
	assert.equal(stats.noShows, 1);
	assert.equal(stats.lateCancellations, 1);
	assert.equal(stats.cancellations, 1);
	assert.deepEqual(stats.favouriteClass, { title: "WOD", count: 2 });
	assert.deepEqual(stats.favouriteTime, { time: "17:30", count: 2 });
	assert.deepEqual(stats.timeOfDay, { morning: 1, midday: 0, evening: 2 });
	// Tuesday ×2, Thursday ×1
	assert.deepEqual(stats.weekdays, [0, 2, 0, 1, 0, 0, 0]);
	assert.deepEqual(stats.bestMonth, { year: 2026, month: 10, count: 2 });
	assert.equal(stats.averageLeadDays, 1.5);
	assert.equal(stats.since, "2026-09-29T15:30:00.000Z");
});

test("weekly streaks", () => {
	const stats = computePersonalStats(
		[
			// Three weeks in a row ending last week, then a gap, then two weeks
			reg("2026-10-13T17:30:00+02:00", "OnTime"),
			reg("2026-10-06T17:30:00+02:00", "OnTime"),
			reg("2026-09-29T17:30:00+02:00", "OnTime"),
			reg("2026-09-15T17:30:00+02:00", "OnTime"),
			reg("2026-09-08T17:30:00+02:00", "OnTime"),
		],
		NOW,
		TZ,
	);
	// No class yet this week: the streak still counts until the week is over.
	assert.equal(stats.currentStreakWeeks, 3);
	assert.equal(stats.longestStreakWeeks, 3);

	const broken = computePersonalStats(
		[reg("2026-10-06T17:30:00+02:00", "OnTime")],
		NOW,
		TZ,
	);
	assert.equal(broken.currentStreakWeeks, 0);
	assert.equal(broken.longestStreakWeeks, 1);
});

test("heatmap covers 12 weeks Monday-first, with future days empty", () => {
	const stats = computePersonalStats(
		[
			reg("2026-10-20T17:30:00+02:00", "OnTime"),
			reg("2026-10-23T06:00:00+02:00", "OnTime"),
		],
		NOW,
		TZ,
	);
	assert.equal(stats.heatmap.length, 84);
	assert.equal(stats.heatmapStart, "2026-08-03");
	// Last row: Mon 19 … Sun 25 October; Tuesday attended, Friday is today
	assert.deepEqual(stats.heatmap.slice(-7), [0, 1, 0, 0, 1, null, null]);
});
