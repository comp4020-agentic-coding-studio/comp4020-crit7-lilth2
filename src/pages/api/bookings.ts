import type { APIRoute } from "astro";
import { addBooking, getRoom } from "../../lib/db";
import { bus } from "../../lib/events";

// "YYYY-MM-DDTHH:MM", the shape <input type="datetime-local"> submits (see
// CLAUDE.md). Round-tripping through a UTC-anchored Date (append "Z" so no
// host timezone is ever consulted) and comparing the result back to the
// input catches both a malformed string and a calendar that doesn't exist
// (e.g. "2026-02-30", which Date would otherwise silently roll into March).
function isValidNaiveDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const d = new Date(`${value}:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 16) === value;
}

function parsePositiveInt(value: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const roomIdRaw = String(form.get("roomId") ?? "").trim();
  const title = String(form.get("title") ?? "").trim();
  const bookedBy = String(form.get("bookedBy") ?? "").trim();
  const startsAt = String(form.get("startsAt") ?? "");
  const endsAt = String(form.get("endsAt") ?? "");
  const minSeatsRaw = String(form.get("minSeats") ?? "").trim();
  const maxSeatsRaw = String(form.get("maxSeats") ?? "").trim();
  const equipment = form.getAll("equipment").map(String);

  // A roomId present means "book this room"; absent means "find me one" —
  // never a write. See CLAUDE.md.
  const isSearch = !roomIdRaw;
  // Scrolls (and, on the book form, keeps in view) the form the visitor was
  // actually on when a validation error sends them back to "/".
  const anchor = isSearch ? "search-form" : "book-form";

  const params = new URLSearchParams();
  if (title) params.set("title", title);
  if (bookedBy) params.set("bookedBy", bookedBy);
  if (startsAt) params.set("startsAt", startsAt);
  if (endsAt) params.set("endsAt", endsAt);
  if (minSeatsRaw) params.set("minSeats", minSeatsRaw);
  if (maxSeatsRaw) params.set("maxSeats", maxSeatsRaw);
  for (const tag of equipment) params.append("equipment", tag);

  // Resolve and re-attach the room *before* any error redirect below, so a
  // rejected submission (a bad time range, a missing name) never bounces the
  // visitor's room choice back to "Not sure" — it was lost here before.
  let roomId: number | undefined;
  if (!isSearch) {
    const parsed = Number(roomIdRaw);
    if (!Number.isInteger(parsed) || !getRoom(parsed)) {
      return redirect(`/?error=invalid_room&${params.toString()}#${anchor}`, 303);
    }
    roomId = parsed;
    params.set("room", String(roomId));
  }

  if (!startsAt || !endsAt || !isValidNaiveDateTime(startsAt) || !isValidNaiveDateTime(endsAt)) {
    return redirect(`/?error=invalid_dates&${params.toString()}#${anchor}`, 303);
  }
  if (startsAt >= endsAt) {
    return redirect(`/?error=invalid_range&${params.toString()}#${anchor}`, 303);
  }

  const minSeats = minSeatsRaw ? parsePositiveInt(minSeatsRaw) : undefined;
  if (minSeatsRaw && minSeats === undefined) {
    return redirect(`/?error=invalid_seats&${params.toString()}#${anchor}`, 303);
  }
  const maxSeats = maxSeatsRaw ? parsePositiveInt(maxSeatsRaw) : undefined;
  if (maxSeatsRaw && maxSeats === undefined) {
    return redirect(`/?error=invalid_seats&${params.toString()}#${anchor}`, 303);
  }
  if (minSeats !== undefined && maxSeats !== undefined && minSeats > maxSeats) {
    return redirect(`/?error=bad_seats&${params.toString()}#${anchor}`, 303);
  }

  if (isSearch) {
    // "How many people" is the one hard capacity condition a search needs —
    // without it findAvailableRooms has nothing to hard-filter on.
    if (minSeats === undefined) {
      return redirect(`/?error=missing_seats&${params.toString()}#${anchor}`, 303);
    }
    return redirect(`/?find=1&${params.toString()}#suggestions`, 303);
  }

  // roomId is set whenever isSearch is false (checked above).
  if (roomId === undefined) {
    return redirect(`/?error=invalid_room&${params.toString()}#${anchor}`, 303);
  }
  if (!bookedBy) {
    return redirect(`/?error=missing_name&${params.toString()}#${anchor}`, 303);
  }

  const result = addBooking({
    roomId,
    title: title ? title.slice(0, 200) : null,
    bookedBy: bookedBy.slice(0, 200),
    startsAt,
    endsAt,
  });

  if (!result.ok) {
    return redirect(`/?error=conflict&${params.toString()}#${anchor}`, 303);
  }

  bus.emit("booking", result.booking);

  // Carry the confirmed booking's own details back, not the search draft —
  // the confirmation banner should say what was actually booked, and the
  // fragment scrolls (and, via CSS :target, highlights) that room's new
  // entry in the board below without any client JS.
  const confirmed = new URLSearchParams();
  confirmed.set("success", "1");
  confirmed.set("room", String(roomId));
  confirmed.set("bookedBy", result.booking.bookedBy);
  confirmed.set("startsAt", result.booking.startsAt);
  confirmed.set("endsAt", result.booking.endsAt);
  if (result.booking.title) confirmed.set("title", result.booking.title);
  return redirect(`/?${confirmed.toString()}#booking-${result.booking.id}`, 303);
};
