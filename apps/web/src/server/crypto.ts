import "@tanstack/react-start/server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for BookingBoard passwords and tokens at rest.
// Stored as "v1:" + base64(iv | auth tag | ciphertext).
const VERSION = "v1";

function key(): Buffer {
	const raw = process.env.APP_ENCRYPTION_KEY;
	const decoded = raw ? Buffer.from(raw, "base64") : undefined;
	if (decoded?.length !== 32) {
		throw new Error(
			"APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)",
		);
	}
	return decoded;
}

export function encrypt(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
	return `${VERSION}:${payload.toString("base64")}`;
}

export function decrypt(stored: string): string {
	const [version, encoded] = stored.split(":");
	if (version !== VERSION || !encoded) {
		throw new Error("Unsupported ciphertext format");
	}
	const payload = Buffer.from(encoded, "base64");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key(),
		payload.subarray(0, 12),
	);
	decipher.setAuthTag(payload.subarray(12, 28));
	return Buffer.concat([
		decipher.update(payload.subarray(28)),
		decipher.final(),
	]).toString("utf8");
}
