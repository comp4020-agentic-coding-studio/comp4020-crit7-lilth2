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
  know a room's name, pick it. If you only know what you need — a rough seat
  count, a projector, wheelchair access — the form should still get you to a
  room instead of forcing a guess. `findAvailableRooms` hard-filters on
  availability and a minimum seat count (a room that's too small never
  shows, fuzzy or not), then ranks the rest by equipment match and how close
  the capacity is to what you asked for.

What I chose *not* to build: this isn't the whole ANU room-booking system.
There's no recurring bookings, no login, no cancellation, and the room
catalogue is a fixed seed list rather than the real one. The recommender
also doesn't save a search, and if nothing fits a requirement at all it
still shows the closest available rooms rather than a dead end — there's no
"nothing works, try something else" state. Modelling one true constraint
(no double-booking) plus a real recommendation path end to end mattered more
than breadth. The rules this produced live in `CLAUDE.md`; the checks that
protect them live in `spec/bookings.test.ts` and `spec/invariants.test.ts`.
