import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { db } from "#/db/index.ts";
import { pushSubscriptions } from "#/db/schema.ts";

export type Notification = { title: string; body: string; url?: string };

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
export const pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
if (pushConfigured) {
	webpush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
}
export const vapidPublicKey = VAPID_PUBLIC_KEY;

/** Send a notification to all of a user's devices. Returns how many accepted it. */
export async function notifyUser(userId: number, notification: Notification): Promise<number> {
	console.log(`[notify user ${userId}] ${notification.title}: ${notification.body}`);
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
				{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
				payload,
				{ TTL: 24 * 60 * 60 },
			);
			delivered++;
		} catch (error) {
			// 404/410: the browser dropped the subscription (uninstalled, permission revoked).
			if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
				db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
			} else {
				console.error(`[notify user ${userId}] push failed`, error);
			}
		}
	}
	return delivered;
}
