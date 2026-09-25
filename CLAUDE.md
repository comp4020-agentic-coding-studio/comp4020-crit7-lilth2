# Your harness

## Domain rules

- **The room, not the form, enforces "no double booking."** Any code that
  writes a booking must go through `addBooking` in `src/lib/db.ts`, which
  checks for an overlapping booking on the same room before inserting. Never
  add a second, client-side-only conflict check that isn't backed by this —
  a bare `fetch` (or a disabled-JS client) has to hit the same rule the form
  does.
- **Datetimes are plain `TEXT` columns in the shape `<input type="datetime-local">`
  produces** (`YYYY-MM-DDTHH:MM`). That format sorts and compares
  lexicographically the same as it does chronologically, so overlap checks
  are plain `lt`/`gt` in SQL — no date parsing needed in the query layer. If
  a future change needs timezones or all-day events, that assumption breaks
  and the comparison needs revisiting, not just the input type.
- **Schema changes go through `pnpm db:generate`, never a hand-edited
  migration or a hand-edited database.** Edit `src/lib/schema.ts`, generate,
  commit both the schema and the migration it writes under `drizzle/`.
- **A room's equipment is a comma-separated `TEXT` column**, same convention
  and same reasoning as the datetime rule above: a small, fixed vocabulary
  (`EQUIPMENT_TAGS` in `src/lib/db.ts`) doesn't earn a join table. Split it
  with `roomEquipment()` rather than re-deriving the split elsewhere.
- **A booking POST with no `roomId` is a search, never a write.** That branch
  in `src/pages/api/bookings.ts` must only ever call `findAvailableRooms` and
  redirect — it must never reach `addBooking`. If a future change adds more
  ways to search, keep that boundary explicit rather than letting a search
  path fall through into the booking path by accident.

## Process

- Cite real commit SHAs in `PROCESS.md` as you go (`[`sha`](compare-url)`),
  not as a last step before shipping — it's much easier to point at the right
  range while the work is fresh than to reconstruct it from `git log` later.
- Run `pnpm check` before calling anything done. The starter's invariants and
  the guestbook-turned-bookings test are the floor; keep them green and treat
  a red one as a real regression, not noise to route around.
