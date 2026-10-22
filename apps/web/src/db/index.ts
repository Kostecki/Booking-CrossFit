import "@tanstack/react-start/server-only";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

// Shared by the web server and the worker; both run migrations on start (idempotent).
const dataDir = resolve(process.env.DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(join(dataDir, "app.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

migrate(db, {
	migrationsFolder: resolve(process.env.MIGRATIONS_DIR ?? "drizzle"),
});
