import { beforeAll, describe, expect, inject, it } from "vitest";

// The week's contract, turned into checks: a booking persists across a
// reload, a second booking that overlaps the same room and time is refused
// rather than silently double-booking the room, and an accepted booking
// reaches other open tabs over the SSE stream.
const baseUrl = inject("baseUrl");

// Room id 1 is "Marie Reay 4.03" — the first room the fresh test database is
// seeded with (see src/lib/db.ts). Every test picks its own time slot so
// tests can run in any order without tripping each other's conflict check.
const ROOM_ID = 1;

describe("room bookings", () => {
  let probe: string;
  let slotStart: string;
  let slotEnd: string;

  beforeAll(() => {
    probe = `spec probe ${process.hrtime.bigint()}`;
    // A slot far enough in the future, and unique enough per test run, that
    // it can't collide with a slot another concurrent test run picked.
    const base = Date.now() + Number(process.hrtime.bigint() % 1_000_000n) * 60_000;
    const start = new Date(base);
    const end = new Date(base + 60 * 60_000);
    const iso = (d: Date) => d.toISOString().slice(0, 16);
    slotStart = iso(start);
    slotEnd = iso(end);
  });

  // Astro checks form POSTs carry a same-origin Origin header (CSRF
  // protection); browsers send it automatically, a bare fetch doesn't.
  const post = (path: string, body: URLSearchParams) =>
    fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { origin: baseUrl },
      body,
      redirect: "manual",
    });

  const bookingForm = (overrides: Record<string, string> = {}) =>
    new URLSearchParams({
      roomId: String(ROOM_ID),
      title: probe,
      bookedBy: "spec",
      startsAt: slotStart,
      endsAt: slotEnd,
      ...overrides,
    });

  it("accepts a booking and redirects back to the board", async () => {
    const res = await post("/api/bookings", bookingForm());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  it("persists the booking: a fresh page load includes it", async () => {
    const res = await fetch(baseUrl);
    expect(await res.text()).toContain(probe);
  });

  it("refuses a second booking that overlaps the same room and time", async () => {
    const clash = `${probe} clash`;
    const res = await post("/api/bookings", bookingForm({ title: clash }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/?error=conflict&room=${ROOM_ID}`);

    // rejected, so it never reaches the board
    const board = await fetch(baseUrl);
    expect(await board.text()).not.toContain(clash);
  });

  it("shows the conflict as a banner on the board", async () => {
    const res = await fetch(new URL(`/?error=conflict&room=${ROOM_ID}`, baseUrl));
    const html = await res.text();
    expect(html).toMatch(/already booked/i);
  });

  it("broadcasts an accepted booking over the SSE stream", async () => {
    const live = `${probe} live`;
    // a slot after the first booking's, so it doesn't conflict
    const laterStart = new Date(new Date(slotEnd).getTime() + 60 * 60_000).toISOString().slice(0, 16);
    const laterEnd = new Date(new Date(laterStart).getTime() + 60 * 60_000).toISOString().slice(0, 16);

    const stream = await fetch(new URL("/api/events", baseUrl));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("no response body");

    await post("/api/bookings", bookingForm({ title: live, startsAt: laterStart, endsAt: laterEnd }));

    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes(live)) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before the event arrived");
      received += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(received).toContain(`data: `);
    expect(received).toContain(live);
  }, 10_000);
});
