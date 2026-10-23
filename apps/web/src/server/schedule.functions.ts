import { getTimePartsInZone, weekdayForDate } from "@booking/core/automation";
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { scheduleSlots, users } from "#/db/schema.ts";

import { loadTimetable, TIME_ZONE } from "./bookingboard.ts";
import { authMiddleware } from "./middleware.ts";

export type SlotOption = {
	classTitle: string;
	weekday: number;
	hour: number;
	minute: number;
	selected: boolean;
	// False when the gym no longer offers it (kept so it can be removed).
	offered: boolean;
};

const slotKey = (s: {
	classTitle: string;
	weekday: number;
	hour: number;
	minute: number;
}) => `${s.classTitle}|${s.weekday}|${s.hour}|${s.minute}`;

// Monday first.
const weekdayOrder = (weekday: number) => (weekday + 6) % 7;

/** Every distinct (class, weekday, time) the gym offers, with the user's picks marked. */
export const getTimetable = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context: { user } }) => {
		const classes = await loadTimetable(user);
		const selected = db
			.select()
			.from(scheduleSlots)
			.where(eq(scheduleSlots.userId, user.id))
			.all();
		const selectedKeys = new Set(selected.map(slotKey));

		const options = new Map<string, SlotOption>();
		for (const cls of classes) {
			const ms = Date.parse(cls.begins);
			if (!Number.isFinite(ms) || !cls.title) continue;
			const { year, month, day, hour, minute } = getTimePartsInZone(
				ms,
				TIME_ZONE,
			);
			// Titles vary in case ("WOD" / "wod"); matching ignores case, so merge them.
			const slot = {
				classTitle: cls.title.trim().toUpperCase(),
				weekday: weekdayForDate(year, month, day),
				hour,
				minute,
			};
			const key = slotKey(slot);
			if (!options.has(key)) {
				options.set(key, {
					...slot,
					selected: selectedKeys.has(key),
					offered: true,
				});
			}
		}
		for (const slot of selected) {
			const key = slotKey(slot);
			if (!options.has(key)) {
				const { classTitle, weekday, hour, minute } = slot;
				options.set(key, {
					classTitle,
					weekday,
					hour,
					minute,
					selected: true,
					offered: false,
				});
			}
		}

		return [...options.values()].sort(
			(a, b) =>
				weekdayOrder(a.weekday) - weekdayOrder(b.weekday) ||
				a.hour - b.hour ||
				a.minute - b.minute ||
				a.classTitle.localeCompare(b.classTitle, "da"),
		);
	});

export const setSlot = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator(
		(input: {
			classTitle: string;
			weekday: number;
			hour: number;
			minute: number;
			selected: boolean;
		}) => {
			const { classTitle, weekday, hour, minute, selected } = input;
			const valid =
				typeof classTitle === "string" &&
				classTitle.trim() !== "" &&
				Number.isInteger(weekday) &&
				weekday >= 0 &&
				weekday <= 6 &&
				Number.isInteger(hour) &&
				hour >= 0 &&
				hour <= 23 &&
				Number.isInteger(minute) &&
				minute >= 0 &&
				minute <= 59 &&
				typeof selected === "boolean";
			if (!valid) throw new Error("Invalid slot");
			return {
				classTitle: classTitle.trim().toUpperCase(),
				weekday,
				hour,
				minute,
				selected,
			};
		},
	)
	.handler(async ({ data: { selected, ...slot }, context: { user } }) => {
		if (selected) {
			db.insert(scheduleSlots)
				.values({ userId: user.id, ...slot })
				.onConflictDoNothing()
				.run();
		} else {
			db.delete(scheduleSlots)
				.where(
					and(
						eq(scheduleSlots.userId, user.id),
						eq(scheduleSlots.classTitle, slot.classTitle),
						eq(scheduleSlots.weekday, slot.weekday),
						eq(scheduleSlots.hour, slot.hour),
						eq(scheduleSlots.minute, slot.minute),
					),
				)
				.run();
		}
	});

export const setPaused = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator((input: { paused: boolean }) => ({
		paused: input?.paused === true,
	}))
	.handler(async ({ data: { paused }, context: { user } }) => {
		if (user.status === "needs_reauth") throw new Error("Log ind igen først");
		db.update(users)
			.set({ status: paused ? "paused" : "active" })
			.where(eq(users.id, user.id))
			.run();
	});
