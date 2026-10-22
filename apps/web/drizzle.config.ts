import { join } from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	// Same database the app uses (src/db/index.ts).
	dbCredentials: { url: join(process.env.DATA_DIR ?? "data", "app.db") },
});
