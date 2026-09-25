import type { APIRoute } from "astro";
import { addBooking } from "../../lib/db";
import { bus } from "../../lib/events";

// The write half of the demo: a plain HTML form POSTs here. The room select
// isn't required — leaving it on "not sure" makes this a search, not a
// booking: no row is written, and the visitor is redirected to the
// recommended-rooms view instead (this branch must never mutate state — see
// CLAUDE.md). When a room is picked, a booking goes into SQLite (after a
// conflict check against the room's existing bookings) and is broadcast to
// every open SSE connection. The 303 redirect makes the form work with no
// client-side JavaScript at all — the submitting tab re-renders from the
// database; every *other* tab hears about it over the stream.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const roomIdRaw = String(form.get("roomId") ?? "").trim();
  const title = String(form.get("title") ?? "").trim();
  const bookedBy = String(form.get("bookedBy") ?? "").trim();
  const startsAt = String(form.get("startsAt") ?? "");
  const endsAt = String(form.get("endsAt") ?? "");
  const minSeats = String(form.get("minSeats") ?? "").trim();
  const maxSeats = String(form.get("maxSeats") ?? "").trim();
  const equipment = form.getAll("equipment").map(String);

  // Carried on every redirect so the page re-renders with what was typed,
  // whether that lands on an error, a suggestion list, or a conflict banner.
  const params = new URLSearchParams();
  if (title) params.set("title", title);
  if (bookedBy) params.set("bookedBy", bookedBy);
  if (startsAt) params.set("startsAt", startsAt);
  if (endsAt) params.set("endsAt", endsAt);
  if (minSeats) params.set("minSeats", minSeats);
  if (maxSeats) params.set("maxSeats", maxSeats);
  for (const tag of equipment) params.append("equipment", tag);

  if (!bookedBy || !startsAt || !endsAt || startsAt >= endsAt) {
    return redirect(`/?error=invalid&${params.toString()}`, 303);
  }

  if (!roomIdRaw) {
    return redirect(`/?find=1&${params.toString()}`, 303);
  }

  const roomId = Number(roomIdRaw);
  if (!roomId) {
    return redirect(`/?error=invalid&${params.toString()}`, 303);
  }
  params.set("room", String(roomId));

  const result = addBooking({
    roomId,
    title: title ? title.slice(0, 200) : null,
    bookedBy: bookedBy.slice(0, 200),
    startsAt,
    endsAt,
  });

  if (!result.ok) {
    return redirect(`/?error=conflict&${params.toString()}`, 303);
  }

  bus.emit("booking", result.booking);
  return redirect("/", 303);
};
