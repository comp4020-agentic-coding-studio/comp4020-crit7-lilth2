import { sql } from "drizzle-orm";
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts), locally and deployed. Never edit the database
// by hand: state on the deployed volume outlives every deploy, and the
// migration trail is what keeps old state and new code compatible.
export const rooms = sqliteTable("rooms", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull().unique(),
  building: text().notNull(),
  capacity: int().notNull(),
});

export const bookings = sqliteTable("bookings", {
  id: int().primaryKey({ autoIncrement: true }),
  roomId: int("room_id")
    .notNull()
    .references(() => rooms.id),
  title: text().notNull(),
  bookedBy: text("booked_by").notNull(),
  // "YYYY-MM-DDTHH:MM" strings (what <input type="datetime-local"> gives us)
  // — same-format text sorts and compares chronologically in SQL, so the
  // overlap check in src/lib/db.ts works as plain lt/gt.
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Room = typeof rooms.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
