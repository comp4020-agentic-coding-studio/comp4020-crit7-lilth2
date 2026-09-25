import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { type Booking, bookings, type Room, rooms } from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

// Seed the handful of rooms this slice books against. Idempotent so it's
// safe to run on every boot: the real ANU room catalogue is out of scope for
// this slice, but a fixed, named set makes the conflict check demoable.
const seedRooms: Array<Omit<Room, "id">> = [
  { name: "Marie Reay 4.03", building: "Marie Reay Building (155)", capacity: 30 },
  { name: "CSIT N101", building: "CSIT Building (108)", capacity: 60 },
  { name: "Hanna Neumann 1.32", building: "Hanna Neumann Building (145)", capacity: 20 },
  { name: "Copland G027", building: "Copland Building (24)", capacity: 120 },
];
if (db.select().from(rooms).all().length === 0) {
  for (const room of seedRooms) {
    db.insert(rooms).values(room).run();
  }
}

export type { Booking, Room };

export function listRooms(): Room[] {
  return db.select().from(rooms).orderBy(asc(rooms.name)).all();
}

export function listBookings(): Booking[] {
  return db.select().from(bookings).orderBy(asc(bookings.startsAt)).all();
}

// Two intervals [aStart, aEnd) and [bStart, bEnd) overlap iff each starts
// before the other ends. Comparing the room's existing bookings against the
// proposed slot this way is the one rule that makes "a room" a real
// constraint instead of just a label on a booking.
function hasConflict(roomId: number, startsAt: string, endsAt: string): boolean {
  const clashes = db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.roomId, roomId),
        lt(bookings.startsAt, endsAt),
        gt(bookings.endsAt, startsAt),
      ),
    )
    .all();
  return clashes.length > 0;
}

export type BookingResult = { ok: true; booking: Booking } | { ok: false; reason: "conflict" };

export function addBooking(input: {
  roomId: number;
  title: string;
  bookedBy: string;
  startsAt: string;
  endsAt: string;
}): BookingResult {
  if (hasConflict(input.roomId, input.startsAt, input.endsAt)) {
    return { ok: false, reason: "conflict" };
  }
  const booking = db.insert(bookings).values(input).returning().get();
  return { ok: true, booking };
}
