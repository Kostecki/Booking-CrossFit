import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type BookingAutomationConfig,
	runBookingAutomation,
} from "../lib/bookingAutomation.ts";
import type { ClassRegistration, ClazzMobile } from "../types.ts";

const json = (value: unknown) => new Response(JSON.stringify(value), {
	headers: { "Content-Type": "application/json" },
});

// Fake BookingBoard API: serves the given bookings and classes, and records requests.
// A POST to /api/Participations adds a SignedUp registration.
async function withFakeApi(
	bookings: ClassRegistration[],
	classes: ClazzMobile[],
	run: (requests: string[]) => Promise<void>,
	handle?: (method: string, path: string) => Response | undefined,
): Promise<void> {
	const realFetch = globalThis.fetch;
	const realNow = Date.now;
	const requests: string[] = [];

	Date.now = () => Date.parse("2026-10-16T12:00:00+02:00");
	globalThis.fetch = async (input, init) => {
		const path = new URL(String(input)).pathname;
		const method = init?.method ?? "GET";
		requests.push(`${method} ${path}`);
		const handled = handle?.(method, path);
		if (handled) return handled;
		if (path === "/api/accounts/1/bookings") return json(bookings);
		if (path === "/api/Classes") return json(classes);
		if (path === "/api/Participations" && method === "POST") {
			const { classHourId } = JSON.parse(String(init?.body));
			const cls = classes.find((c) => c.id === classHourId)!;
			const registration: ClassRegistration = {
				id: bookings.length + 1000,
				classId: cls.id,
				className: cls.title,
				begins: cls.begins,
				status: "SignedUp",
			};
			bookings.push(registration);
			return json(registration);
		}
		const detail = path.match(/^\/api\/Classes\/(\d+)$/);
		if (detail) return json(classes.find((c) => c.id === Number(detail[1])));
		throw new Error(`Unexpected request: ${method} ${path}`);
	};

	try {
		await run(requests);
	} finally {
		globalThis.fetch = realFetch;
		Date.now = realNow;
	}
}

function config(
	overrides: Partial<BookingAutomationConfig>,
): BookingAutomationConfig {
	return {
		token: "test",
		accountId: 1,
		centerTimeZone: "Europe/Copenhagen",
		slots: [],
		maxTotalSessions: 5,
		dryRun: false,
		pendingRebookClassIds: [],
		log: () => {},
		...overrides,
	};
}

const cls = (id: number, title: string, begins: string): ClazzMobile => ({
	id,
	title,
	begins,
	ends: begins,
});

// Three weeks of WOD Tue/Thu 17:30 and Gymnastics Fri 12:30 (DST ends 25 Oct),
// plus classes that match a slot's day or time but not all of it.
const schedule: ClazzMobile[] = [
	cls(1, "WOD", "2026-10-20T17:30:00+02:00"),
	cls(2, "WOD", "2026-10-22T17:30:00+02:00"),
	cls(3, "Gymnastics", "2026-10-23T12:30:00+02:00"),
	cls(4, "WOD", "2026-10-27T17:30:00+01:00"),
	cls(5, "WOD", "2026-10-29T17:30:00+01:00"),
	cls(6, "Gymnastics", "2026-10-30T12:30:00+01:00"),
	cls(7, "WOD", "2026-11-03T17:30:00+01:00"),
	cls(8, "WOD", "2026-11-05T17:30:00+01:00"),
	cls(9, "Gymnastics", "2026-11-06T12:30:00+01:00"),
	cls(90, "WOD", "2026-10-21T17:30:00+02:00"), // Wednesday
	cls(91, "Gymnastics", "2026-10-20T17:30:00+02:00"), // wrong title for Tue
	cls(92, "WOD", "2026-10-23T12:30:00+02:00"), // wrong title for Fri
	cls(93, "WOD", "2026-10-22T16:30:00+02:00"), // wrong time
];

const slots = [
	{ classTitle: "WOD", weekday: 2, hour: 17, minute: 30 },
	{ classTitle: "WOD", weekday: 4, hour: 17, minute: 30 },
	{ classTitle: "Gymnastics", weekday: 5, hour: 12, minute: 30 },
];

test("books the next classes matching any slot until the total cap", async () => {
	await withFakeApi([], schedule, async () => {
		const booked = await runBookingAutomation(config({ slots }));
		assert.deepEqual(booked.map((b) => b.classId), [1, 2, 3, 4, 5]);
		assert.deepEqual(
			booked.map((b) => b.timeLabel),
			["WOD 17:30", "WOD 17:30", "Gymnastics 12:30", "WOD 17:30", "WOD 17:30"],
		);
	});
});

test("an optional weekly cap leaves the remaining slots of a week unbooked", async () => {
	await withFakeApi([], schedule, async () => {
		const booked = await runBookingAutomation(
			config({ slots, maxSessionsPerWeek: 2 }),
		);
		assert.deepEqual(booked.map((b) => b.classId), [1, 2, 4, 5, 7]);
	});
});

test("a skipped class is never booked and the next matching class takes its spot", async () => {
	await withFakeApi([], schedule, async (requests) => {
		const booked = await runBookingAutomation(
			config({ slots, skipClassIds: [2] }),
		);
		assert.deepEqual(booked.map((b) => b.classId), [1, 3, 4, 5, 6]);
		assert.ok(!requests.includes("GET /api/Classes/2"));
	});
});

test("a one-time request rebooks a cancelled class before later classes", async () => {
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
		cls(1458123, "WOD", "2026-11-03T17:30:00+01:00"),
		cls(1459111, "WOD", "2026-11-05T17:30:00+01:00"),
	];
	const reactivate = (method: string, path: string) => {
		if (path !== "/api/Participations/7146311" || method !== "PUT") return;
		bookings[4]!.status = "SignedUp";
		return json(bookings[4]);
	};

	await withFakeApi(bookings, classes, async (requests) => {
		const booked = await runBookingAutomation(
			config({
				slots: slots.slice(0, 2),
				maxSessionsPerWeek: 2,
				pendingRebookClassIds: [1458123],
			}),
		);
		assert.equal(booked.length, 1);
		assert.equal(booked[0]!.rebooked, true);
		assert.match(booked[0]!.labelDa, /3\. November/);
		assert.ok(requests.includes("PUT /api/Participations/7146311"));
		assert.ok(!requests.includes("POST /api/Participations"));
	}, reactivate);
});

test("unknown statuses and waiting-list bookings are logged for debugging", async () => {
	const bookings: ClassRegistration[] = [
		{ id: 1, classId: 1, className: "WOD", begins: "2026-10-20T17:30:00+02:00", status: "OnWaitingList" },
	];
	// A full class: the POST comes back as something other than SignedUp.
	const joinWaitingList = (method: string, path: string) => {
		if (path !== "/api/Participations" || method !== "POST") return;
		const registration: ClassRegistration = {
			id: 2,
			classId: 2,
			className: "WOD",
			begins: "2026-10-22T17:30:00+02:00",
			status: "OnWaitingList",
		};
		bookings.push(registration);
		return json(registration);
	};

	await withFakeApi(bookings, schedule.slice(0, 2), async () => {
		const lines: string[] = [];
		const booked = await runBookingAutomation(
			config({ slots: slots.slice(0, 2), log: (line) => lines.push(line) }),
		);
		assert.deepEqual(booked.map((b) => [b.classId, b.waitingList]), [[2, true]]);
		assert.ok(lines.some((l) => l.startsWith("[waitlist-debug] unknown-status ") && l.includes('"OnWaitingList"')));
		const bookedLine = lines.find((l) => l.startsWith("[waitlist-debug] booked-not-signed-up "));
		assert.ok(bookedLine);
		assert.equal(JSON.parse(bookedLine.slice("[waitlist-debug] booked-not-signed-up ".length)).response.status, "OnWaitingList");
	}, joinWaitingList);
});
