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

// The fixed equipment vocabulary a room's `equipment` column draws its
// comma-separated tags from (see src/lib/schema.ts). A small, closed set
// keeps the search below simple string matching instead of needing a
// separate join table for what's still a handful of possible tags.
export const EQUIPMENT_TAGS = [
  { id: "projector", label: "Projector / display screen" },
  { id: "whiteboard", label: "Whiteboard" },
  { id: "video_conferencing", label: "Video conferencing" },
  { id: "accessible", label: "Wheelchair accessible" },
] as const;

export type EquipmentTagId = (typeof EQUIPMENT_TAGS)[number]["id"];

// Seed the handful of rooms this slice books against. Idempotent so it's
// safe to run on every boot: the real ANU room catalogue is out of scope for
// this slice, but a fixed, named set makes the conflict check demoable.
const seedRooms: Array<Omit<Room, "id">> = [
  {
    name: "Marie Reay 4.03",
    building: "Marie Reay Building (155)",
    capacity: 30,
    equipment: "projector,whiteboard",
  },
  {
    name: "CSIT N101",
    building: "CSIT Building (108)",
    capacity: 60,
    equipment: "projector,video_conferencing",
  },
  {
    name: "Hanna Neumann 1.32",
    building: "Hanna Neumann Building (145)",
    capacity: 20,
    equipment: "whiteboard,accessible",
  },
  {
    name: "Copland G027",
    building: "Copland Building (24)",
    capacity: 120,
    equipment: "projector,video_conferencing,accessible",
  },
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

export function roomEquipment(room: Room): string[] {
  return room.equipment ? room.equipment.split(",").filter(Boolean) : [];
}

// Two intervals [aStart, aEnd) and [bStart, bEnd) overlap iff each starts
// before the other ends. Comparing a room's existing bookings against a
// proposed slot this way is the one rule that makes "a room" a real
// constraint instead of just a label on a booking. Exported so the search
// below can reuse it instead of duplicating the overlap query.
export function isRoomBooked(roomId: number, startsAt: string, endsAt: string): boolean {
  const clashes = db
    .select()
    .from(bookings)
    .where(and(eq(bookings.roomId, roomId), lt(bookings.startsAt, endsAt), gt(bookings.endsAt, startsAt)))
    .all();
  return clashes.length > 0;
}

export type RoomSuggestion = { room: Room; matchedEquipment: string[] };

// The recommender behind "just tell me what fits". Availability and a seat
// floor are hard filters — a booked or too-small room is never a fit, fuzzy
// or not. Equipment match and how far a room overshoots the requested seat
// ceiling are soft ranking signals instead: there's no hard seat ceiling, so
// a search that nothing fits exactly still returns the closest rooms rather
// than nothing.
export function findAvailableRooms(input: {
  startsAt: string;
  endsAt: string;
  minSeats?: number;
  maxSeats?: number;
  equipment?: string[];
}): RoomSuggestion[] {
  const requested = input.equipment ?? [];

  const available = listRooms().filter((room) => {
    if (input.minSeats !== undefined && room.capacity < input.minSeats) return false;
    return !isRoomBooked(room.id, input.startsAt, input.endsAt);
  });

  return available
    .map((room) => {
      const have = new Set(roomEquipment(room));
      const matchedEquipment = requested.filter((tag) => have.has(tag));
      const overshoot =
        input.maxSeats !== undefined && room.capacity > input.maxSeats ? room.capacity - input.maxSeats : 0;
      return { room, matchedEquipment, overshoot };
    })
    .sort((a, b) => {
      if (b.matchedEquipment.length !== a.matchedEquipment.length) {
        return b.matchedEquipment.length - a.matchedEquipment.length;
      }
      if (a.overshoot !== b.overshoot) return a.overshoot - b.overshoot;
      return a.room.capacity - b.room.capacity;
    })
    .slice(0, 5)
    .map(({ room, matchedEquipment }) => ({ room, matchedEquipment }));
}

export type BookingResult = { ok: true; booking: Booking } | { ok: false; reason: "conflict" };

export function addBooking(input: {
  roomId: number;
  title: string | null;
  bookedBy: string;
  startsAt: string;
  endsAt: string;
}): BookingResult {
  if (isRoomBooked(input.roomId, input.startsAt, input.endsAt)) {
    return { ok: false, reason: "conflict" };
  }
  const booking = db.insert(bookings).values(input).returning().get();
  return { ok: true, booking };
}
