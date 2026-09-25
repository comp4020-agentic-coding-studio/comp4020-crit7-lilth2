# ANU room booking

A slice of the room-booking system ANU staff and students actually deal with:
a fixed set of rooms, a booking form, and one rule that makes a room a real
constraint instead of just a label on an event — two bookings for the same
room can't overlap in time.

Pick a room, say what it's for and when, and book it. The booking lands in
SQLite immediately (reload the page — it's still there), and shows up on
every other open tab within a second or two over a live stream, the way a
shared booking board should.

## What good looks like here

Good, for this slice, means:

- **The room is the constraint, not the form.** A booking system that lets
  two events double-book the same room at the same time isn't modelling
  rooms at all — it's just a list of events with a room name attached. The
  overlap check in `src/lib/db.ts` (`hasConflict`) is the one piece of domain
  logic that makes "a room" mean something, and it's enforced server-side —
  a JavaScript-disabled client submitting the form directly still can't
  double-book a room.
- **State survives everything a real booking board has to survive:** a
  reload, a redeploy, a second person hitting the same room at the same
  moment. SQLite on the machine's volume (see `fly.toml`) is what makes that
  true; `spec/bookings.test.ts` is what checks it.
- **The board is honest about what happened.** Rejecting a conflicting
  booking silently would be worse than not checking at all — the form
  redirects back with a banner naming the room and telling you to pick
  another slot, rather than pretending the double-booking never happened.

What I chose *not* to build: this isn't the whole ANU room-booking system.
There's no room search, no recurring bookings, no login, no cancellation, and
the room catalogue is a fixed seed list rather than the real one — modelling
one true constraint (no double-booking) end to end mattered more than
breadth. The rules this produced live in `CLAUDE.md`; the checks that
protect them live in `spec/bookings.test.ts` and `spec/invariants.test.ts`.
