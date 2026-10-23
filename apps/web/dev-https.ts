import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";

// Local HTTPS for testing the PWA on a phone (service workers, install, push all need
// a trusted certificate). With HTTPS=1, mkcert (brew install mkcert) issues a
// certificate for localhost, the Mac's LAN IPs and its Bonjour name; the phone trusts
// it once mkcert's root CA is installed there. See the README.
//
// The phone is pointed at the IP: on some networks the phone can't resolve the
// .local name even though the Mac is reachable.
export function devHttps(): Plugin {
	const enabled = Boolean(process.env.HTTPS);
	const local = bonjourName();
	const ips = lanIPv4s();
	return {
		name: "dev-https",
		apply: "serve",
		config() {
			if (!enabled) return;
			const hosts = ["localhost", "127.0.0.1", local, ...ips];
			const dir = ".cert";
			// Named after the hosts, so a new IP (or Mac name) gets a new certificate.
			const id = createHash("sha256")
				.update(hosts.join(","))
				.digest("hex")
				.slice(0, 12);
			const cert = join(dir, `dev-${id}.pem`);
			const key = join(dir, `dev-${id}-key.pem`);
			if (!existsSync(cert) || !existsSync(key)) {
				mkdirSync(dir, { recursive: true });
				for (const file of readdirSync(dir)) rmSync(join(dir, file));
				execFileSync(
					"mkcert",
					["-cert-file", cert, "-key-file", key, ...hosts],
					{
						stdio: "inherit",
					},
				);
			}
			return {
				server: { https: { cert: readFileSync(cert), key: readFileSync(key) } },
			};
		},
		configureServer(server) {
			if (!enabled) return;
			// Vite only prints bare IPs; show the URLs the certificate is valid for,
			// with the port Vite actually got.
			server.httpServer?.once("listening", () => {
				const address = server.httpServer?.address();
				const port =
					typeof address === "object" && address ? address.port : 3000;
				const urls = [...ips, local].map((host) => `https://${host}:${port}/`);
				console.log(`\n  ➜  Phone:   ${urls.join("  or  ")}\n`);
			});
		},
	};
}

function bonjourName(): string {
	try {
		const name = execFileSync("scutil", ["--get", "LocalHostName"], {
			encoding: "utf8",
		}).trim();
		return `${name}.local`;
	} catch {
		const name = hostname();
		return name.endsWith(".local") ? name : `${name}.local`;
	}
}

// The Mac's LAN IPv4 addresses, skipping loopback and Tailscale (100.64.0.0/10).
function lanIPv4s(): string[] {
	return Object.values(networkInterfaces())
		.flat()
		.filter((a) => a && a.family === "IPv4" && !a.internal)
		.map((a) => a?.address ?? "")
		.filter((ip) => ip && !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip));
}
