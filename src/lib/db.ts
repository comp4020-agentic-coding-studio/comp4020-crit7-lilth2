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
//
// `hard: true` marks a tag that, once requested, is never negotiable — a
// room without it isn't a fit, fuzzy or not. Only wheelchair accessibility
// is hard today: it's an access requirement, not a preference like "has a
// whiteboard", so findAvailableRooms below must never rank around it the
// way it ranks around the others.
export const EQUIPMENT_TAGS = [
  { id: "projector", label: "Projector / display screen", hard: false },
  { id: "whiteboard", label: "Whiteboard", hard: false },
  { id: "video_conferencing", label: "Video conferencing", hard: false },
  { id: "accessible", label: "Wheelchair accessible", hard: true },
] as const;

export type EquipmentTagId = (typeof EQUIPMENT_TAGS)[number]["id"];

function equipmentLabel(tagId: string): string {
  return EQUIPMENT_TAGS.find((tag) => tag.id === tagId)?.label ?? tagId;
}

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

// The `equipment` column was added by a later migration (drizzle/0001) with
// a `''` default, so a room that already existed on someone's deployed
// volume upgrades into an *empty* equipment string, not the seed's real
// tags — the seeding block above only ever fires on a table with zero rows,
// so it can't fix that up. Run this on every boot, unconditionally: for each
// known seed room that exists but still has no equipment recorded, fill in
// the tags the current seed list says it should have. It only ever touches
// a row that both matches a seed name and is still blank, so it's a no-op
// once a deployment has caught up.
export function backfillSeedEquipment(): void {
  for (const seed of seedRooms) {
    const existing = db.select().from(rooms).where(eq(rooms.name, seed.name)).get();
    if (existing && !existing.equipment) {
      db.update(rooms).set({ equipment: seed.equipment }).where(eq(rooms.id, existing.id)).run();
    }
  }
}
backfillSeedEquipment();

export type { Booking, Room };

export function listRooms(): Room[] {
  return db.select().from(rooms).orderBy(asc(rooms.name)).all();
}

export function getRoom(id: number): Room | undefined {
  return db.select().from(rooms).where(eq(rooms.id, id)).get();
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

export type RoomMatch = {
  room: Room;
  // Preferred (non-hard) tags the visitor asked for that this room doesn't
  // have — empty means it has all of them. Never includes a hard tag: a
  // room that lacks one is filtered out entirely, never shown as "close".
  missingEquipment: string[];
  // How many seats this room has over the requested ceiling (0 if within it
  // or no ceiling was given).
  overshoot: number;
  // No missing preferred equipment and no overshoot — a full fit, not just
  // the closest available one.
  exact: boolean;
};

export type RoomSearchResult =
  | { ok: true; exact: RoomMatch[]; close: RoomMatch[] }
  | {
      // Why zero rooms qualified, so the page can say something more useful
      // than "nothing's free": no room is even that big (capacity), a big
      // enough room exists but none has a requested hard requirement
      // (requirements), or a room fitting both exists but every one of them
      // is booked for that slot (availability).
      ok: false;
      reason: "capacity" | "requirements" | "availability";
      largestCapacity: number;
    };

// The recommender behind "just tell me what fits". Time availability, the
// seat floor, and any hard (accessibility) equipment tag are hard filters —
// none of them is negotiable, fuzzy or not. A requested seat ceiling and any
// non-hard equipment tag are soft ranking signals instead: a room that
// overshoots the ceiling or is missing a nice-to-have still shows, just
// ranked as a "close" match rather than an exact one, with what's different
// about it named explicitly.
export function findAvailableRooms(input: {
  startsAt: string;
  endsAt: string;
  minSeats: number;
  maxSeats?: number;
  equipment?: string[];
}): RoomSearchResult {
  const requested = input.equipment ?? [];
  const requiredTags = requested.filter((id) => EQUIPMENT_TAGS.find((tag) => tag.id === id)?.hard);
  const preferredTags = requested.filter((id) => !requiredTags.includes(id));

  const allRooms = listRooms();
  const largestCapacity = allRooms.reduce((max, room) => Math.max(max, room.capacity), 0);

  const bigEnough = allRooms.filter((room) => room.capacity >= input.minSeats);
  if (bigEnough.length === 0) {
    return { ok: false, reason: "capacity", largestCapacity };
  }

  const meetsRequirements = bigEnough.filter((room) => {
    const have = new Set(roomEquipment(room));
    return requiredTags.every((tag) => have.has(tag));
  });
  if (meetsRequirements.length === 0) {
    return { ok: false, reason: "requirements", largestCapacity };
  }

  const available = meetsRequirements.filter((room) => !isRoomBooked(room.id, input.startsAt, input.endsAt));
  if (available.length === 0) {
    return { ok: false, reason: "availability", largestCapacity };
  }

  const matches: RoomMatch[] = available.map((room) => {
    const have = new Set(roomEquipment(room));
    const missingEquipment = preferredTags.filter((tag) => !have.has(tag));
    const overshoot =
      input.maxSeats !== undefined && room.capacity > input.maxSeats ? room.capacity - input.maxSeats : 0;
    return { room, missingEquipment, overshoot, exact: missingEquipment.length === 0 && overshoot === 0 };
  });

  matches.sort((a, b) => {
    if (a.missingEquipment.length !== b.missingEquipment.length) {
      return a.missingEquipment.length - b.missingEquipment.length;
    }
    if (a.overshoot !== b.overshoot) return a.overshoot - b.overshoot;
    return a.room.capacity - b.room.capacity;
  });

  return {
    ok: true,
    exact: matches.filter((m) => m.exact).slice(0, 5),
    close: matches.filter((m) => !m.exact).slice(0, 5),
  };
}

export { equipmentLabel };

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
