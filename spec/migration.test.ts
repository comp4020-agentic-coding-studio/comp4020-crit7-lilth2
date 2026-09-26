import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Replays the exact upgrade path a pre-existing deployment goes through: a
// room row created before migration 0001 added `equipment` (see
// drizzle/0001_massive_chat.sql:17, which gives every existing row a bare
// '' default — the empty-table seed in src/lib/db.ts can't fix that, it
// only ever fires against a table with zero rows). Built against a real
// temp SQLite file and the app's own `./drizzle` folder, not mocked, so
// this exercises the same `migrate()` call src/lib/db.ts makes at boot.
describe("legacy equipment backfill", () => {
  let dbPath: string;

  beforeAll(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), "migration-spec-")), "legacy.db");

    // A migrations folder containing only 0000 — applying it (and only it)
    // against a fresh file reproduces exactly what a deployment's volume
    // looked like the moment before 0001 ever ran.
    const stage1Dir = mkdtempSync(join(tmpdir(), "migration-spec-stage1-"));
    mkdirSync(join(stage1Dir, "meta"));
    const migration0000 = readFileSync(join(__dirname, "../drizzle/0000_gifted_blue_shield.sql"));
    writeFileSync(join(stage1Dir, "0000_gifted_blue_shield.sql"), migration0000);
    const realJournal = JSON.parse(readFileSync(join(__dirname, "../drizzle/meta/_journal.json"), "utf8"));
    const stage1Journal = { ...realJournal, entries: realJournal.entries.slice(0, 1) };
    writeFileSync(join(stage1Dir, "meta/_journal.json"), JSON.stringify(stage1Journal));

    const client = new Database(dbPath);
    migrate(drizzle(client), { migrationsFolder: stage1Dir });

    // A room matching a seed name, inserted the way it would have been on
    // migration 0000's schema — no `equipment` column exists yet, so this
    // can't set one.
    client
      .prepare("INSERT INTO rooms (name, building, capacity) VALUES (?, ?, ?)")
      .run("Marie Reay 4.03", "Marie Reay Building (155)", 30);
    client.close();
  });

  afterAll(() => {
    delete process.env.DATABASE_PATH;
  });

  it("gives a pre-existing room its seed equipment back once 0001 and the backfill both run", async () => {
    process.env.DATABASE_PATH = dbPath;
    // src/lib/db.ts runs migrate() (against the real ./drizzle folder — 0000
    // is skipped by hash, 0001 applies, adding `equipment` with its `''`
    // default), then the empty-table seed (a no-op, the table isn't empty),
    // then backfillSeedEquipment() — all as module-level side effects, the
    // same sequence the app runs at every boot.
    const { getRoom, listRooms } = await import("../src/lib/db");

    const room = listRooms().find((r) => r.name === "Marie Reay 4.03");
    expect(room).toBeDefined();
    expect(room?.equipment).toBe("projector,whiteboard");
    expect(getRoom(room!.id)?.equipment).toBe("projector,whiteboard");
  });
});
