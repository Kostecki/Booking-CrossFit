import type { BookedClass } from "@booking/core/automation";
import { computePersonalStats, type PersonalStats } from "@booking/core/stats";
import { createServerFn } from "@tanstack/react-start";
import { count, desc, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { runs, scheduleSlots, users } from "#/db/schema.ts";

import { loadBookings, TIME_ZONE } from "./bookingboard.ts";
import { authMiddleware } from "./middleware.ts";

export type AppStats = {
	// This user
	bookedForYou: number;
	waitingListBookings: number;
	successfulRuns: number;
	memberSince: string;
	// Everyone, anonymous
	bookedForEveryone: number;
	activeUsers: number;
	totalRuns: number;
	popularSlot?: {
		classTitle: string;
		weekday: number; // 0=Sun…6=Sat
		time: string;
		users: number;
	};
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Fun numbers about the user's training (from the cached BookingBoard bookings, so no
 * extra requests) and about what the app has booked, for them and for everyone.
 */
export const getStats = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(
		async ({
			context: { user },
		}): Promise<{ personal: PersonalStats | null; app: AppStats }> => {
			const personal = await loadBookings(user)
				.then((bookings) =>
					computePersonalStats(bookings, Date.now(), TIME_ZONE),
				)
				// The app numbers still work when BookingBoard doesn't.
				.catch(() => null);

			const allRuns = db
				.select({
					userId: runs.userId,
					status: runs.status,
					bookedJson: runs.bookedJson,
				})
				.from(runs)
				.all();
			let bookedForYou = 0;
			let waitingListBookings = 0;
			let bookedForEveryone = 0;
			for (const run of allRuns) {
				const booked: BookedClass[] = run.bookedJson
					? JSON.parse(run.bookedJson)
					: [];
				bookedForEveryone += booked.length;
				if (run.userId !== user.id) continue;
				bookedForYou += booked.length;
				waitingListBookings += booked.filter((b) => b.waitingList).length;
			}

			const popular = db
				.select({
					classTitle: scheduleSlots.classTitle,
					weekday: scheduleSlots.weekday,
					hour: scheduleSlots.hour,
					minute: scheduleSlots.minute,
					users: count(),
				})
				.from(scheduleSlots)
				.groupBy(
					scheduleSlots.classTitle,
					scheduleSlots.weekday,
					scheduleSlots.hour,
					scheduleSlots.minute,
				)
				.orderBy(desc(count()))
				.limit(1)
				.get();

			return {
				personal,
				app: {
					bookedForYou,
					waitingListBookings,
					successfulRuns: allRuns.filter(
						(run) => run.userId === user.id && run.status === "ok",
					).length,
					memberSince: user.createdAt.toISOString(),
					bookedForEveryone,
					activeUsers:
						db
							.select({ n: count() })
							.from(users)
							.where(eq(users.status, "active"))
							.get()?.n ?? 0,
					totalRuns: allRuns.length,
					popularSlot: popular && {
						classTitle: popular.classTitle,
						weekday: popular.weekday,
						time: `${pad(popular.hour)}:${pad(popular.minute)}`,
						users: popular.users,
					},
				},
			};
		},
	);
