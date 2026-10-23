import { execSync } from "node:child_process";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { devHttps } from "./dev-https.ts";

/**
 * The commit this build is from: COMMIT_SHA in CI (the Docker build has no
 * .git), otherwise asked from git, otherwise "dev".
 */
function commitSha() {
	if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;
	try {
		return execSync("git rev-parse HEAD", {
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		return "dev";
	}
}

export default defineConfig({
	// Shown in Settings, to tell which version is running
	define: {
		__COMMIT_SHA__: JSON.stringify(commitSha()),
		__BUILD_TIME__: JSON.stringify(new Date().toISOString()),
	},
	resolve: { tsconfigPaths: true },
	plugins: [
		nitro({ rollupConfig: { external: ["better-sqlite3"] } }),
		tanstackStart(),
		viteReact(),
		// `pnpm dev:https`: HTTPS with a locally trusted certificate, for testing on a phone.
		devHttps(),
	],
});
