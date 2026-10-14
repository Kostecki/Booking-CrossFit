import assert from "node:assert/strict";
import { test } from "node:test";
import { runBookingAutomation } from "../lib/bookingAutomation.ts";
import type { ClassRegistration, ClazzMobile } from "../types.ts";

test("a one-time request rebooks a cancelled class before later classes", async () => {
	const realFetch = globalThis.fetch;
	const realNow = Date.now;
	const realLog = console.log;
	const requests: string[] = [];
	const activeDates = ["2026-10-20", "2026-10-22", "2026-10-27", "2026-10-29"];
	const bookings: ClassRegistration[] = activeDates.map((day, index) => ({
		id: index + 1,
		classId: index + 100,
		className: "WOD",
		begins: `${day}T17:30:00+01:00`,
		status: "SignedUp",
	}));
	bookings.push({
		id: 7146311,
		classId: 1458123,
		className: "WOD",
		begins: "2026-11-03T17:30:00+01:00",
		status: "OptedOut",
	});
	const classes: ClazzMobile[] = [
		{ id: 1458123, title: "WOD", begins: "2026-11-03T17:30:00+01:00", ends: "2026-11-03T18:30:00+01:00" },
		{ id: 1459111, title: "WOD", begins: "2026-11-05T17:30:00+01:00", ends: "2026-11-05T18:30:00+01:00" },
	];
	const json = (value: unknown) => new Response(JSON.stringify(value), {
		headers: { "Content-Type": "application/json" },
	});

	Date.now = () => Date.parse("2026-10-16T12:00:00+02:00");
	console.log = () => {};
	globalThis.fetch = async (input, init) => {
		const path = new URL(String(input)).pathname;
		const method = init?.method ?? "GET";
		requests.push(`${method} ${path}`);
		if (path === "/api/accounts/1/bookings") return json(bookings);
		if (path === "/api/Classes") return json(classes);
		if (path === "/api/Classes/1458123") return json(classes[0]);
		if (path === "/api/Participations/7146311" && method === "PUT") {
			bookings[4]!.status = "SignedUp";
			return json(bookings[4]);
		}
		throw new Error(`Unexpected request: ${method} ${path}`);
	};

	try {
		const booked = await runBookingAutomation({
			token: "test",
			accountId: 1,
			centerTimeZone: "Europe/Copenhagen",
			people: {},
			classTitle: "WOD",
			targetWeekdays: [2, 4],
			maxSessionsPerWeek: 2,
			maxTotalSessions: 5,
			targetHour: 17,
			targetMinute: 30,
			dryRun: false,
			pendingRebookClassIds: [1458123],
		});
		assert.equal(booked.length, 1);
		assert.match(booked[0]!, /3\. november/);
		assert.ok(requests.includes("PUT /api/Participations/7146311"));
		assert.ok(!requests.includes("POST /api/Participations"));
	} finally {
		globalThis.fetch = realFetch;
		Date.now = realNow;
		console.log = realLog;
	}
});
