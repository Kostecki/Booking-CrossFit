// Discover participantIds for TRACKED_PEOPLE.
// Usage: node --env-file=.env scripts/find-participants.ts <classId>
//
// Prints everyone signed up for the given class as "Name — participantId" so you can
// copy the ids of the people you want to track into TRACKED_PEOPLE in .env.

import { getClassDetail, login } from "../bookingApi.ts";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing required environment variable: ${name}`);
		process.exit(1);
	}
	return value;
}

const email = requireEnv("API_EMAIL");
const password = requireEnv("API_PASSWORD");
const chainId = Number(requireEnv("CHAIN_ID"));

const classId = Number(process.argv[2]);
if (!Number.isFinite(classId)) {
	console.error(
		"Usage: node --env-file=.env scripts/find-participants.ts <classId>",
	);
	process.exit(1);
}

const token = await login({ email, password, chainId });
const detail = await getClassDetail(token, classId);
const participants = detail.participants ?? [];

console.log(
	`${detail.title} @ ${detail.begins} — ${participants.length} participant(s):\n`,
);
for (const p of [...participants].sort((a, b) =>
	a.participantName.localeCompare(b.participantName),
)) {
	console.log(`  ${p.participantName}  —  ${p.participantId}  [${p.status}]`);
}
