# ANU room booking

A slice of the room-booking system ANU staff and students actually deal with:
a fixed set of rooms, a booking form, and one rule that makes a room a real
constraint instead of just a label on an event — two bookings for the same
room can't overlap in time.

Pick a room, say what it's for and when, and book it — or, if you're not sure
which room, say what you need instead (a seat range, a projector, a
wheelchair-accessible room) and get back the available rooms that fit best.
The booking lands in SQLite immediately (reload the page — it's still
there), and shows up on every other open tab within a second or two over a
live stream, the way a shared booking board should.

## What good looks like here

Good, for this slice, means:

- **The room is the constraint, not the form.** A booking system that lets
  two events double-book the same room at the same time isn't modelling
  rooms at all — it's just a list of events with a room name attached. The
  overlap check in `src/lib/db.ts` (`isRoomBooked`) is the one piece of
  domain logic that makes "a room" mean something, and it's enforced
  server-side — a JavaScript-disabled client submitting the form directly
  still can't double-book a room.
- **State survives everything a real booking board has to survive:** a
  reload, a redeploy, a second person hitting the same room at the same
  moment. SQLite on the machine's volume (see `fly.toml`) is what makes that
  true; `spec/bookings.test.ts` is what checks it.
- **The board is honest about what happened.** Rejecting a conflicting
  booking silently would be worse than not checking at all — the form
  redirects back with a banner naming the room and telling you to pick
  another slot, rather than pretending the double-booking never happened.
- **Not knowing which room is a real, common case, not an edge case.** If you
  know a room's name, pick it directly in "Confirm booking". If you only
  know what you need — a rough seat count, equipment, wheelchair access —
  "Find available rooms" gets you there instead of forcing a guess.
  `findAvailableRooms` treats time availability, the minimum seat count, and
  wheelchair accessibility as hard filters: a room that's too small, already
  booked, or genuinely not accessible never shows, not even as a "close"
  suggestion. Everything else — a seat *ceiling*, a projector, a whiteboard —
  is a soft preference: a room missing one still shows as a close match,
  with what it's missing or overshooting on named explicitly, rather than
  being silently dropped.
- **A dead end says why, not just "nothing's free".** If zero rooms
  qualify, the page distinguishes three different reasons — no room is even
  that big, a big-enough room exists but none has a required accessibility
  need, or a room fitting both exists but every one is booked for that
  slot — instead of one generic empty state.
- **A room's equipment survives an upgrade, not just a fresh install.**
  `equipment` was added to `rooms` in a later migration, which gives any
  room that already existed an empty string, not its real tags.
  `backfillSeedEquipment()` fixes that up on every boot for the seed rooms;
  `spec/migration.test.ts` replays that exact upgrade — apply the old
  migration, insert a pre-upgrade room, then apply the new one — rather
  than just asserting the backfill function looks right in isolation.

What I chose *not* to build: this isn't the whole ANU room-booking system.
There's no recurring bookings, no login, no cancellation, and the room
catalogue is a fixed seed list rather than the real one. The recommender
also doesn't save a search. Modelling one true constraint (no double-
booking) plus a real recommendation path end to end mattered more than
breadth. The rules this produced live in `CLAUDE.md`; the checks that
protect them live in `spec/bookings.test.ts`, `spec/migration.test.ts`, and
`spec/invariants.test.ts`.
