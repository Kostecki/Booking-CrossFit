import assert from "node:assert/strict";
import { test } from "node:test";

import {
	formatRunTimes,
	nextRunLabel,
	normalizeRunTimes,
	runScheduleLabel,
	runTimeCron,
} from "../lib/runTimes.ts";

const TZ = "Europe/Copenhagen";

test("normalizeRunTimes sorts, pads and dedupes", () => {
	assert.deepEqual(normalizeRunTimes(["19:00", "7:30", "19:00"]), {
		ok: true,
		times: ["07:30", "19:00"],
	});
});

test("normalizeRunTimes rejects bad input", () => {
	assert.equal(normalizeRunTimes([]).ok, false);
	assert.equal(normalizeRunTimes(["25:00"]).ok, false);
	assert.equal(normalizeRunTimes(["19"]).ok, false);
	assert.equal(normalizeRunTimes(["19:00", "19:30"]).ok, false);
	// Too close across midnight
	assert.equal(normalizeRunTimes(["23:30", "00:10"]).ok, false);
	assert.equal(
		normalizeRunTimes(["01:00", "05:00", "09:00", "13:00", "17:00"]).ok,
		false,
	);
});

test("runTimeCron", () => {
	assert.equal(runTimeCron("07:05"), "5 7 * * *");
});

test("formatRunTimes and runScheduleLabel", () => {
	assert.equal(formatRunTimes(["19:00"]), "kl. 19:00");
	assert.equal(formatRunTimes(["07:00", "19:00"]), "kl. 07:00 og 19:00");
	assert.equal(
		formatRunTimes(["07:00", "12:00", "19:00"]),
		"kl. 07:00, 12:00 og 19:00",
	);
	assert.equal(runScheduleLabel(["19:00"]), "hver aften kl. 19:00");
	assert.equal(runScheduleLabel(["07:00"]), "hver dag kl. 07:00");
	assert.equal(
		runScheduleLabel(["07:00", "19:00"]),
		"hver dag kl. 07:00 og 19:00",
	);
});

test("nextRunLabel", () => {
	const at = (iso: string) => Date.parse(iso);
	const times = ["07:00", "19:00"];
	assert.equal(
		nextRunLabel(times, at("2026-10-23T06:00:00+02:00"), TZ),
		"i dag kl. 07:00",
	);
	assert.equal(
		nextRunLabel(times, at("2026-10-23T12:00:00+02:00"), TZ),
		"i aften kl. 19:00",
	);
	assert.equal(
		nextRunLabel(times, at("2026-10-23T19:00:00+02:00"), TZ),
		"i morgen kl. 07:00",
	);
});
