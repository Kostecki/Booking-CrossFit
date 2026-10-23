import "@tanstack/react-start/server-only";
import { DEFAULT_RUN_TIMES } from "@booking/core/runTimes";
import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { appSettings } from "#/db/schema.ts";

// Values stored in app_settings, by key.
type Settings = {
	// "HH:MM" in the gym's time zone, sorted (normalizeRunTimes)
	runTimes: string[];
	// Written by the worker on every queue poll.
	workerHeartbeat: {
		at: string;
		nextRun: string | null;
		dailyInProgress: boolean;
	};
	// Set by an admin; the worker starts a run for everyone and deletes it.
	runAllRequestedAt: string;
};

export function getSetting<K extends keyof Settings>(
	key: K,
): Settings[K] | undefined {
	const row = db
		.select({ value: appSettings.value })
		.from(appSettings)
		.where(eq(appSettings.key, key))
		.get();
	return row ? (JSON.parse(row.value) as Settings[K]) : undefined;
}

export function setSetting<K extends keyof Settings>(
	key: K,
	value: Settings[K],
): void {
	const json = JSON.stringify(value);
	db.insert(appSettings)
		.values({ key, value: json })
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value: json, updatedAt: new Date() },
		})
		.run();
}

export function deleteSetting(key: keyof Settings): void {
	db.delete(appSettings).where(eq(appSettings.key, key)).run();
}

export const getRunTimes = (): string[] =>
	getSetting("runTimes") ?? DEFAULT_RUN_TIMES;
