import { sql } from "drizzle-orm";
import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

const userId = () =>
	integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" });

export const users = sqliteTable("users", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	// BookingBoard accountId: the identity users log in as.
	bbAccountId: integer("bb_account_id").notNull().unique(),
	email: text("email").notNull(),
	fullName: text("full_name").notNull(),
	// AES-GCM ciphertexts, see server/crypto.ts.
	encPassword: text("enc_password").notNull(),
	encToken: text("enc_token"),
	status: text("status", { enum: ["active", "paused", "needs_reauth"] })
		.notNull()
		.default("active"),
	createdAt: createdAt(),
});

// A recurring class to book every week.
export const scheduleSlots = sqliteTable(
	"schedule_slots",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: userId(),
		classTitle: text("class_title").notNull(),
		weekday: integer("weekday").notNull(), // 0=Sun…6=Sat
		hour: integer("hour").notNull(),
		minute: integer("minute").notNull(),
	},
	(t) => [
		uniqueIndex("schedule_slots_unique").on(
			t.userId,
			t.classTitle,
			t.weekday,
			t.hour,
			t.minute,
		),
	],
);

// A cancelled class to book once more when a spot frees up.
export const rebookRequests = sqliteTable(
	"rebook_requests",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: userId(),
		classId: integer("class_id").notNull(),
		status: text("status", { enum: ["pending", "done"] })
			.notNull()
			.default("pending"),
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex("rebook_requests_unique").on(t.userId, t.classId)],
);

// A single class occurrence the user won't attend; never booked.
export const skips = sqliteTable(
	"skips",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: userId(),
		classId: integer("class_id").notNull(),
		begins: text("begins").notNull(), // ISO-8601, for pruning past skips
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex("skips_unique").on(t.userId, t.classId)],
);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	userId: userId(),
	endpoint: text("endpoint").notNull().unique(),
	p256dh: text("p256dh").notNull(),
	auth: text("auth").notNull(),
	createdAt: createdAt(),
});

export const runs = sqliteTable("runs", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	userId: userId(),
	trigger: text("trigger", { enum: ["daily", "manual"] }).notNull(),
	status: text("status", { enum: ["queued", "running", "ok", "error"] })
		.notNull()
		.default("queued"),
	createdAt: createdAt(),
	startedAt: integer("started_at", { mode: "timestamp_ms" }),
	finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
	// BookedClass[] from @booking/core/automation
	bookedJson: text("booked_json"),
	error: text("error"),
	log: text("log"),
});

export const sessions = sqliteTable("sessions", {
	// SHA-256 of the cookie value, so a leaked DB doesn't leak live sessions.
	id: text("id").primaryKey(),
	userId: userId(),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
