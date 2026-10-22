// Service worker: shows Web Push notifications and opens the app when one is tapped.
// No offline caching: the app needs the server for everything it shows.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
	const payload = event.data ? event.data.json() : {};
	event.waitUntil(
		self.registration.showNotification(payload.title ?? "CrossFit Booking", {
			body: payload.body ?? "",
			icon: "/icons/icon-192.png",
			data: { url: payload.url ?? "/" },
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			const existing = windows.find((client) => client.url.startsWith(self.location.origin));
			if (existing) {
				await existing.focus();
				return existing.navigate(url);
			}
			return self.clients.openWindow(url);
		})(),
	);
});
