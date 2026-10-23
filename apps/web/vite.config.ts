import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		nitro({ rollupConfig: { external: ["better-sqlite3"] } }),
		tanstackStart(),
		viteReact(),
	],
});
