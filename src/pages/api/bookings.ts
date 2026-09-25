import type { APIRoute } from "astro";
import { addBooking } from "../../lib/db";
import { bus } from "../../lib/events";

// The write half of the demo: a plain HTML form POSTs here, the booking goes
// into SQLite (after a conflict check against the room's existing bookings),
// and an accepted booking is broadcast to every open SSE connection. The 303
// redirect makes the form work with no client-side JavaScript at all — the
// submitting tab re-renders from the database; every *other* tab hears about
// it over the stream.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const roomId = Number(form.get("roomId"));
  const title = String(form.get("title") ?? "").trim();
  const bookedBy = String(form.get("bookedBy") ?? "").trim();
  const startsAt = String(form.get("startsAt") ?? "");
  const endsAt = String(form.get("endsAt") ?? "");

  if (!roomId || !title || !bookedBy || !startsAt || !endsAt || startsAt >= endsAt) {
    return redirect(`/?error=invalid&room=${roomId}`, 303);
  }

  const result = addBooking({
    roomId,
    title: title.slice(0, 200),
    bookedBy: bookedBy.slice(0, 200),
    startsAt,
    endsAt,
  });

  if (!result.ok) {
    return redirect(`/?error=conflict&room=${roomId}`, 303);
  }

  bus.emit("booking", result.booking);
  return redirect("/", 303);
};
