// Set when the app comes back to the foreground, so the next Bookinger load asks the
// server to skip its cached bookings (they may have changed in the BookingBoard app).
let pending = false;

export function requestFreshData(): void {
	pending = true;
}

/** Whether this load should bypass the cache: a full page load, or a pending request. */
export function takeFreshRequest(): boolean {
	if (typeof window === "undefined") return true;
	const fresh = pending;
	pending = false;
	return fresh;
}
