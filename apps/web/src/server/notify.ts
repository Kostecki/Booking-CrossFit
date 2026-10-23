import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";

import { db } from "#/db/index.ts";
import { pushSubscriptions } from "#/db/schema.ts";

export type Notification = { title: string; body: string; url?: string };

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
let configuredPublicKey: string | undefined;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
	webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
	configuredPublicKey = VAPID_PUBLIC_KEY;
}
/** The VAPID public key for browsers to subscribe with; undefined when push isn't set up. */
export const vapidPublicKey = configuredPublicKey;
export const pushConfigured = vapidPublicKey !== undefined;

/** Send a notification to all of a user's devices. Returns how many accepted it. */
export async function notifyUser(
	userId: number,
	notification: Notification,
): Promise<number> {
	console.log(
		`[notify user ${userId}] ${notification.title}: ${notification.body}`,
	);
	if (!pushConfigured) return 0;

	const subscriptions = db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.userId, userId))
		.all();
	const payload = JSON.stringify(notification);
	let delivered = 0;
	for (const sub of subscriptions) {
		try {
			await webpush.sendNotification(
				{
					endpoint: sub.endpoint,
					keys: { p256dh: sub.p256dh, auth: sub.auth },
				},
				payload,
				{ TTL: 24 * 60 * 60 },
			);
			delivered++;
		} catch (error) {
			// 404/410: the browser dropped the subscription (uninstalled, permission revoked).
			if (
				error instanceof WebPushError &&
				(error.statusCode === 404 || error.statusCode === 410)
			) {
				db.delete(pushSubscriptions)
					.where(eq(pushSubscriptions.id, sub.id))
					.run();
			} else {
				console.error(`[notify user ${userId}] push failed`, error);
			}
		}
	}
	return delivered;
}
