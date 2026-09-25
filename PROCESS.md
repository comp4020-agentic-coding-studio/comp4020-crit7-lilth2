# Process overview

## What I built

A slice of ANU's room-booking system: a fixed set of rooms, each with its own
bookings, and one enforced rule — a room can't hold two overlapping bookings.
`README.md` has the full account of what the app is and what good means here;
this is how it got built.

## How I got here

**This first pass was built by Claude Code (an AI agent) in a single directed
session, from the published crit spec, with no back-and-forth correction from
me during the build — I asked for a working demo and reviewed the result
afterwards.** That's the honest account, not a stronger claim of hands-on
correction I didn't do. Before this counts as *my* submission I still need to:
read every file below, run the app myself, decide whether the room-booking
slice and the conflict rule are actually the "good" I'd argue for, and fix or
redirect whatever I wouldn't defend at the crit. This file should be rewritten
once I've done that, in my own words, citing what I actually changed.

The agent started from the template's guestbook starter (Astro + Drizzle +
better-sqlite3, SQLite on a Fly volume, SSE for live updates) rather than from
scratch, on the reasoning that the plumbing it demonstrates — a form write
that persists and rebroadcasts to open tabs — is the same plumbing a booking
board needs; the domain logic on top is what turns it into a booking system
instead of a guestbook. The build went schema → query layer → API/UI → spec
tests → docs:

[`5aa8890`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/5aa8890)
replaces the guestbook's single `messages` table with `rooms` and `bookings`,
with `bookings.room_id` as a foreign key — the one relationship this slice
needs.

[`8966011`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/8966011)
adds `addBooking` in `src/lib/db.ts`: it checks for an overlapping booking on
the same room before inserting, and returns a typed
`{ ok: false, reason: "conflict" }` rather than throwing, so the caller has to
handle it. The overlap condition is the standard interval-intersection test
(`existing.starts_at < new.ends_at AND existing.ends_at > new.starts_at`) — I
have not yet independently re-derived or stress-tested it myself against edge
cases (identical slot, nested slot, partial overlap on each side); that's on
the list above.

[`9a7729b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/9a7729b)
and
[`08ae065`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/08ae065)
wire the conflict result through: `/api/bookings` redirects to
`/?error=conflict&room=<id>` instead of the generic `/` on a rejected
booking, and the board reads that query string back into a named banner, so
a rejected booking is visible rather than silently dropped.

[`650fb2d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/650fb2d)
turns the crit's mechanically-checkable spec lines into
`spec/bookings.test.ts`, mirroring the starter's own `guestbook.test.ts`
shape: a booking persists across a reload, a second overlapping booking is
refused and never reaches the board, the banner names the room, and an
accepted booking reaches the SSE stream.

**Verification status, honestly:** once a C toolchain became available in
this environment, `pnpm check` (typecheck + build + the full vitest suite)
went green — but not on the first run. `spec/bookings.test.ts`'s SSE test
timed out: it derived a follow-up time slot by round-tripping a naive
`"YYYY-MM-DDTHH:MM"` string through `new Date(...)` twice, and `Date`
parses a string with no zone marker as *local* time while `.toISOString()`
always emits UTC — so the round trip silently shifted the slot by the
machine's UTC offset, landing `laterEnd` before `laterStart`. That tripped
the app's own `startsAt < endsAt` validation, the booking came back
`?error=invalid` instead of being accepted, and the test hung waiting for
an SSE event that never fired. Fixed by parsing consistently as UTC
(commit [`eed0d8d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/eed0d8d)) —
a bug in the test's own arithmetic, not in the app; a real browser's
`datetime-local` input never round-trips through `toISOString` like this,
so it wouldn't have surfaced outside the test.

I also manually exercised the built server outside the test suite: booked
a room, confirmed it persisted on reload, attempted a same-room
overlapping booking and got the `already booked` banner rather than a
silent double-booking, and opened a second SSE connection that received
the new-booking event live while a booking was posted from elsewhere.
All four behaved as `README.md` claims. What I have *not* done is click
through the app in an actual browser window (all of the above went through
`curl`/`fetch` against the built server) — that, and deciding for yourself
whether this slice and its conflict rule are the "good" you'd defend at the
crit, are still yours to do.

## Round two: room requirements, fuzzy recommendation, restyle

After the first pass above, I asked for two more things: make the app look
like the actual COMP4020 course site instead of a generic form, and let a
visitor book without knowing which room they want — give them a title-
optional booking, room equipment tags, and a recommendation when they only
know a time range and some requirements.

For the visual side, rather than guess at "ANU-ish", I fetched the real
course site's compiled CSS and read its `--at-*` custom properties directly
— gold `#be830e`, copper `#be4e0e`, teal `#0085ad`, a darker `#9a6b0b`
specifically for link/text contrast, `border-radius: 0`, Public Sans — and
reused only those (colour, type, spacing, sharp corners), not any ANU
crest/lockup asset, on the app's own plain-text header.

[`1bd7e1b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/1bd7e1b)
makes `bookings.title` nullable and adds `rooms.equipment` as a
comma-separated tag column, via `pnpm db:generate` per `CLAUDE.md`.

[`9521a12`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/9521a12)
adds `findAvailableRooms` in `src/lib/db.ts`: a hard filter on availability
(reusing the existing overlap check, exported as `isRoomBooked`) and a
minimum seat count, then a soft ranking by equipment match count, seat-
ceiling overshoot, and capacity — so an under-specified search still
returns the closest rooms instead of nothing.

[`d83364e`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/d83364e)
turns `/api/bookings` into one endpoint with two outcomes: a `roomId`
present books as before; absent, it's a search, and the handler redirects to
`/?find=1&...` without ever calling `addBooking` — the query string carries
every field the visitor typed so nothing is lost on the redirect.

[`e7b1f74`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/e7b1f74)
is the restyle plus the "Suggested rooms" UI: each suggestion is a plain
link back to `/` with that room preselected via the same query-param-prefill
pattern the conflict banner already used, so picking a recommendation needs
no client JavaScript.

[`0bde1a1`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-lilth2/commit/0bde1a1)
extends `spec/bookings.test.ts`: a titleless booking renders as "Untitled
booking" rather than an empty `<strong>`, a seat requirement only one seed
room satisfies redirects to a search without writing anything and only that
room is suggested, and a `room` query param preselects the right `<option>`
on reload.

**Verification, honestly:** `pnpm check` (typecheck, build, all 32 tests)
was green on the run that produced the commits above — no new bug surfaced
in this round the way the SSE timezone bug did in the first pass. I also
re-ran the dev server and exercised the new paths with `curl` directly:
confirmed the restyled page serves (`#be830e` and the "Not sure — recommend
me one" option both present), confirmed a search for `minSeats=100`
redirects to `/?find=1&...` and its suggestions section names only Copland
G027 (the one 120-seat seed room) and not the three smaller ones, confirmed
`/?room=4` renders that room's `<option>` with `selected`, and confirmed a
booking submitted with an empty title renders as "Untitled booking". I have
still not clicked through this in an actual browser window myself — that
remains mine to do before I'd call this "good" rather than just "checked".

## Before you ship

`pnpm check:evidence` verifies that this comment is gone, that your citations
resolve to real commits, that a crit week's reflection entry is in
`reflections/`, and that your `CLAUDE.md` is there. It checks that your account
is traceable, not that it is good: that is the marker's call.
