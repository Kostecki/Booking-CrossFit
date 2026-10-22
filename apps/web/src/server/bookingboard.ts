import "@tanstack/react-start/server-only";
import { ApiError, getClasses, login, toApiDateTime } from "@booking/core/api";
import { getTimePartsInZone } from "@booking/core/automation";
import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { type User, users } from "#/db/schema.ts";

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

/** All classes from today (gym time) through the API's ~4-week window. */
export function getUpcomingClasses(token: string) {
	const today = getTimePartsInZone(Date.now(), TIME_ZONE);
	return getClasses(token, toApiDateTime(today.year, today.month, today.day));
}
