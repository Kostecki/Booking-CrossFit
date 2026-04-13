import { readFile, writeFile } from "node:fs/promises";

type BookingState = {
	sessionTimestamps: number[];
};

const EIGHT_WEEKS_MS = 8 * 7 * 24 * 60 * 60 * 1000;

export async function loadBookingState(stateFile: string): Promise<number[]> {
	try {
		const content = await readFile(stateFile, "utf-8");
		const state = JSON.parse(content) as BookingState;
		return Array.isArray(state.sessionTimestamps)
			? state.sessionTimestamps
			: [];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

export async function saveBookingState(
	stateFile: string,
	timestamps: number[],
): Promise<void> {
	const cutoffMs = Date.now() - EIGHT_WEEKS_MS;
	const pruned = [...new Set(timestamps)]
		.filter((ms) => ms >= cutoffMs)
		.sort((a, b) => a - b);

	const state: BookingState = { sessionTimestamps: pruned };
	await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}
