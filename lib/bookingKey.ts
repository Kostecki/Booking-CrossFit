export function createBookingKey(resourceId: number, startMs: number): string {
	return `${resourceId}:${startMs}`;
}
