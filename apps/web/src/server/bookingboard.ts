import "@tanstack/react-start/server-only";
import {
	ApiError,
	getClasses,
	getMyBookings,
	login,
	toApiDateTime,
} from "@booking/core/api";
import { getTimePartsInZone } from "@booking/core/automation";
import { and, eq, isNotNull, max } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { runs, type User, users } from "#/db/schema.ts";

import { cached, forget } from "./cache.ts";
import { decrypt, encrypt } from "./crypto.ts";

// Single gym for now: CrossFit Roskilde.
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 291);
export const TIME_ZONE = "Europe/Copenhagen";
// The gym's limit on concurrent bookings.
export const MAX_TOTAL_SESSIONS = 5;

/** Thrown when the stored password no longer logs in; the user must log in again. */
export class NeedsReauthError extends Error {
	constructor() {
		super("BookingBoard login failed; the user must log in again");
		this.name = "NeedsReauthError";
	}
}

export const isAuthFailure = (error: unknown) =>
	error instanceof ApiError && (error.status === 400 || error.status === 401);

async function freshToken(user: User): Promise<string> {
	try {
		const token = await login({
			email: user.email,
			password: decrypt(user.encPassword),
			chainId: CHAIN_ID,
		});
		db.update(users)
			.set({ encToken: encrypt(token) })
			.where(eq(users.id, user.id))
			.run();
		return token;
	} catch (error) {
		if (!isAuthFailure(error)) throw error;
		db.update(users)
			.set({ status: "needs_reauth", encToken: null })
			.where(eq(users.id, user.id))
			.run();
		throw new NeedsReauthError();
	}
}

/**
 * Run `fn` with the user's cached BookingBoard token, logging in again (once) with the
 * stored password when there's no token or it's rejected with a 401.
 */
export async function withBookingToken<T>(
	user: User,
	fn: (token: string) => Promise<T>,
): Promise<T> {
	if (user.encToken) {
		try {
			return await fn(decrypt(user.encToken));
		} catch (error) {
			if (!(error instanceof ApiError && error.status === 401)) throw error;
		}
	}
	return fn(await freshToken(user));
}

const TIMETABLE_TTL_MS = 30 * 60_000;
const BOOKINGS_TTL_MS = 60_000;

/**
 * All classes from today (gym time) through the API's ~4-week window. The same for
 * everyone, so cached for 30 minutes across users.
 */
export function loadTimetable(user: User) {
	const today = getTimePartsInZone(Date.now(), TIME_ZONE);
	const start = toApiDateTime(today.year, today.month, today.day);
	return cached(`timetable:${start}`, TIMETABLE_TTL_MS, () =>
		withBookingToken(user, (token) => getClasses(token, start)),
	);
}

/**
 * The user's bookings, cached for a minute. Refetched when `fresh` (e.g. the app came
 * back to the foreground) or once one of the user's runs has finished since.
 */
export function loadBookings(user: User, { fresh = false } = {}) {
	const lastRun = db
		.select({ id: max(runs.id) })
		.from(runs)
		.where(and(eq(runs.userId, user.id), isNotNull(runs.finishedAt)))
		.get();
	return cached(
		`bookings:${user.id}`,
		BOOKINGS_TTL_MS,
		() =>
			withBookingToken(user, (token) => getMyBookings(token, user.bbAccountId)),
		{ version: lastRun?.id ?? 0, fresh },
	);
}

/** Drop the cached bookings after changing them on BookingBoard. */
export function forgetBookings(userId: number): void {
	forget(`bookings:${userId}`);
}
