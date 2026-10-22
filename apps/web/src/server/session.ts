import "@tanstack/react-start/server-only";
import { createHash, randomBytes } from "node:crypto";
import {
	deleteCookie,
	getCookie,
	setCookie,
} from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { sessions, type User, users } from "#/db/schema.ts";

const COOKIE = "session";
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

export function createSession(userId: number): void {
	const value = randomBytes(32).toString("base64url");
	db.insert(sessions)
		.values({
			id: hash(value),
			userId,
			expiresAt: new Date(Date.now() + MAX_AGE_MS),
		})
		.run();
	setCookie(COOKIE, value, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: MAX_AGE_MS / 1000,
	});
}

export function getSessionUser(): User | undefined {
	const value = getCookie(COOKIE);
	if (!value) return undefined;
	const row = db
		.select({ user: users, expiresAt: sessions.expiresAt })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.id, hash(value)))
		.get();
	if (!row || row.expiresAt.getTime() < Date.now()) return undefined;
	return row.user;
}

export function requireUser(): User {
	const user = getSessionUser();
	if (!user) throw new Error("Not logged in");
	return user;
}

export function destroySession(): void {
	const value = getCookie(COOKIE);
	if (value)
		db.delete(sessions)
			.where(eq(sessions.id, hash(value)))
			.run();
	deleteCookie(COOKIE, { path: "/" });
}
