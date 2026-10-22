import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { pushSubscriptions } from "#/db/schema.ts";

import { authMiddleware } from "./middleware.ts";
import { notifyUser, vapidPublicKey } from "./notify.ts";

export const getPushConfig = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async () => ({
		publicKey: vapidPublicKey ?? null,
	}));

type SubscriptionInput = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

export const savePushSubscription = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator((input: SubscriptionInput) => {
		const { endpoint, keys } = input ?? {};
		if (
			typeof endpoint !== "string" ||
			!endpoint.startsWith("https://") ||
			typeof keys?.p256dh !== "string" ||
			typeof keys?.auth !== "string"
		) {
			throw new Error("Invalid push subscription");
		}
		return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
	})
	.handler(async ({ data, context: { user } }) => {
		// An endpoint belongs to one browser; re-subscribing moves it to the current user.
		db.insert(pushSubscriptions)
			.values({ userId: user.id, ...data })
			.onConflictDoUpdate({
				target: pushSubscriptions.endpoint,
				set: { userId: user.id, p256dh: data.p256dh, auth: data.auth },
			})
			.run();
	});

export const deletePushSubscription = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.validator((input: { endpoint: string }) => ({
		endpoint: String(input?.endpoint ?? ""),
	}))
	.handler(async ({ data: { endpoint }, context: { user } }) => {
		db.delete(pushSubscriptions)
			.where(
				and(
					eq(pushSubscriptions.userId, user.id),
					eq(pushSubscriptions.endpoint, endpoint),
				),
			)
			.run();
	});

export const sendTestNotification = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(async ({ context: { user } }) => {
		const delivered = await notifyUser(user.id, {
			title: "Det virker 💪",
			body: "Du får besked her, når der er booket hold til dig.",
			url: "/",
		});
		return { delivered };
	});
