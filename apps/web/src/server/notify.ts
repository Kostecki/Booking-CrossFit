import "@tanstack/react-start/server-only";

export type Notification = { title: string; body: string; url?: string };

/** Send a notification to all of a user's devices. Web Push is wired up in a later step. */
export async function notifyUser(userId: number, notification: Notification): Promise<void> {
	console.log(`[notify user ${userId}] ${notification.title}: ${notification.body}`);
}
