import "@tanstack/react-start/server-only";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { WAITLIST_DEBUG } from "@booking/core/automation";

import { dataDir } from "#/db/index.ts";

// Temporary: the waiting list's real behaviour hasn't been observed yet. Anything
// unusual is appended to <DATA_DIR>/waitlist-debug.jsonl (one JSON object per line)
// and logged with a "[waitlist-debug]" prefix. Remove once the status is known.
const file = join(dataDir, "waitlist-debug.jsonl");
const seen = new Set<string>();

export function recordWaitlistDebug(
	kind: string,
	userId: number,
	data: unknown,
	// Skips entries already written by this process, e.g. on every page load.
	dedupeKey?: string,
): void {
	if (dedupeKey) {
		if (seen.has(dedupeKey)) return;
		seen.add(dedupeKey);
	}
	const entry = JSON.stringify({
		at: new Date().toISOString(),
		kind,
		userId,
		data,
	});
	console.log(`${WAITLIST_DEBUG} ${entry}`);
	try {
		appendFileSync(file, `${entry}\n`);
	} catch (error) {
		console.error(`${WAITLIST_DEBUG} could not write ${file}`, error);
	}
}
