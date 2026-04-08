export function parseDotNetDate(value: unknown): number | null {
	if (typeof value !== "string") {
		return null;
	}

	const match = value.match(/^\/Date\((-?\d+)\)\/$/);
	if (!match) {
		return null;
	}

	const ms = Number(match[1]);
	return Number.isFinite(ms) ? ms : null;
}
