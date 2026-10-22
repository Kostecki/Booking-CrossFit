import "@tanstack/react-start/server-only";

// Small in-memory cache for BookingBoard reads, to keep requests to their API down.
// Per web-server process; the worker doesn't use it.
type Entry = { value: unknown; expires: number; version: unknown };
const entries = new Map<string, Entry>();

export async function cached<T>(
	key: string,
	ttlMs: number,
	load: () => Promise<T>,
	// `version` must match for a hit (e.g. the user's latest finished run);
	// `fresh` skips the cache but still stores the new value.
	{ version, fresh = false }: { version?: unknown; fresh?: boolean } = {},
): Promise<T> {
	const hit = entries.get(key);
	if (!fresh && hit && hit.expires > Date.now() && hit.version === version) {
		return hit.value as T;
	}
	const value = await load();
	entries.set(key, { value, expires: Date.now() + ttlMs, version });
	return value;
}

export function forget(key: string): void {
	entries.delete(key);
}
