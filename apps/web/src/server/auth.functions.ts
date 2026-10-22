import { getAccount, login } from "@booking/core/api";
import { createServerFn } from "@tanstack/react-start";
import { eq, sql } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { users } from "#/db/schema.ts";
import { CHAIN_ID, isAuthFailure } from "./bookingboard.ts";
import { encrypt } from "./crypto.ts";
import { authMiddleware } from "./middleware.ts";
import { createSession, destroySession, getSessionUser } from "./session.ts";

export type CurrentUser = {
	id: number;
	fullName: string;
	email: string;
	status: "active" | "paused" | "needs_reauth";
};

export const getCurrentUser = createServerFn({ method: "GET" }).handler(
	async (): Promise<CurrentUser | null> => {
		const user = getSessionUser();
		if (!user) return null;
		const { id, fullName, email, status } = user;
		return { id, fullName, email, status };
	},
);

export const loginWithBookingBoard = createServerFn({ method: "POST" })
	.validator((input: { email: string; password: string }) => {
		const email = String(input?.email ?? "").trim();
		const password = String(input?.password ?? "");
		if (!email || !password) throw new Error("Email og adgangskode skal udfyldes");
		return { email, password };
	})
	.handler(async ({ data: { email, password } }) => {
		let token: string;
		try {
			token = await login({ email, password, chainId: CHAIN_ID });
		} catch (error) {
			if (isAuthFailure(error)) {
				return { ok: false as const, error: "Forkert email eller adgangskode" };
			}
			throw error;
		}
		const account = await getAccount(token);

		// Logging in again clears needs_reauth but keeps a deliberate pause.
		const user = db
			.insert(users)
			.values({
				bbAccountId: account.id,
				email,
				fullName: account.fullName,
				encPassword: encrypt(password),
				encToken: encrypt(token),
			})
			.onConflictDoUpdate({
				target: users.bbAccountId,
				set: {
					email,
					fullName: account.fullName,
					encPassword: encrypt(password),
					encToken: encrypt(token),
					status: sql`case when ${users.status} = 'paused' then 'paused' else 'active' end`,
				},
			})
			.returning({ id: users.id })
			.get();

		createSession(user.id);
		return { ok: true as const };
	});

export const logout = createServerFn({ method: "POST" }).handler(async () => {
	destroySession();
});

/** Delete the user and everything stored about them, including the encrypted password. */
export const deleteAccount = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(async ({ context: { user } }) => {
		destroySession();
		db.delete(users).where(eq(users.id, user.id)).run();
	});
