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

  it("accepts a booking and redirects to a success banner with a highlighted row", async () => {
    const res = await post("/api/bookings", bookingForm());
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "", baseUrl);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("success")).toBe("1");
    expect(location.searchParams.get("room")).toBe(String(ROOM_ID));
    expect(location.searchParams.get("bookedBy")).toBe("spec");
    expect(location.searchParams.get("startsAt")).toBe(slotStart);
    // the fragment both scrolls to and (via CSS :target) highlights this
    // exact new booking's row, not just the room board in general.
    expect(location.hash).toMatch(/^#booking-\d+$/);

    const page = await fetch(new URL(`${location.pathname}${location.search}${location.hash}`, baseUrl));
    const html = await page.text();
    expect(html).toMatch(/role="status"/);
    expect(html).toContain("Booked.");
    expect(html).toContain("spec");
  });

  it("persists the booking: a fresh page load includes it", async () => {
    const res = await fetch(baseUrl);
    expect(await res.text()).toContain(probe);
  });

  it("refuses a second booking that overlaps the same room and time", async () => {
    const clash = `${probe} clash`;
    const res = await post("/api/bookings", bookingForm({ title: clash }));
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "", baseUrl);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("error")).toBe("conflict");
    expect(location.searchParams.get("room")).toBe(String(ROOM_ID));

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
    // a slot after the first booking's, so it doesn't conflict. slotEnd (and
    // laterStart, once produced) are naive "YYYY-MM-DDTHH:MM" strings with no
    // timezone marker — the same shape a browser's datetime-local input
    // submits, and the app never attaches one either (see CLAUDE.md). `Date`
    // parses a string like that as *local* time but `toISOString` always
    // emits UTC, so appending "Z" before reparsing keeps both ends of this
    // arithmetic in UTC and avoids a silent shift by the machine's offset.
    const laterStart = new Date(new Date(`${slotEnd}Z`).getTime() + 60 * 60_000).toISOString().slice(0, 16);
    const laterEnd = new Date(new Date(`${laterStart}Z`).getTime() + 60 * 60_000).toISOString().slice(0, 16);

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

  it("accepts a booking with no title and never renders it blank", async () => {
    const marker = `spec-no-title-${process.hrtime.bigint()}`;
    const base = Date.now() + Number(process.hrtime.bigint() % 1_000_000n) * 60_000 + 5 * 60 * 60_000;
    const start = new Date(base).toISOString().slice(0, 16);
    const end = new Date(base + 30 * 60_000).toISOString().slice(0, 16);

    const res = await post("/api/bookings", bookingForm({ title: "", bookedBy: marker, startsAt: start, endsAt: end }));
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "", baseUrl);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("success")).toBe("1");
    expect(location.searchParams.get("title")).toBeNull();

    const board = await fetch(baseUrl);
    const html = await board.text();
    expect(html).toContain(marker);
    expect(html).toContain("Untitled booking");
    // No booking, on any row, ever renders as an empty <strong></strong>.
    // (The live-update <script> template literally contains that string as
    // markup-to-be-filled-in, so exclude it — it's not rendered content.)
    const bodyWithoutScript = html.split("<script")[0];
    expect(bodyWithoutScript).not.toMatch(/<strong>\s*<\/strong>/);
  });

  it("a room requirement that only one room satisfies redirects to a search, without booking anything", async () => {
    // "Copland G027" — the 120-seat lecture theatre, the 4th room seeded (see
    // src/lib/db.ts) — is the only seed room with capacity >= 100.
    const COPLAND_ROOM_ID = 4;
    const base = Date.now() + Number(process.hrtime.bigint() % 1_000_000n) * 60_000 + 10 * 60 * 60_000;
    const start = new Date(base).toISOString().slice(0, 16);
    const end = new Date(base + 60 * 60_000).toISOString().slice(0, 16);

    const res = await post(
      "/api/bookings",
      new URLSearchParams({ roomId: "", bookedBy: "spec-search", startsAt: start, endsAt: end, minSeats: "100" }),
    );
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "", baseUrl);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("find")).toBe("1");
    expect(location.searchParams.get("minSeats")).toBe("100");

    const page = await fetch(new URL(`${location.pathname}${location.search}`, baseUrl));
    const html = await page.text();
    // Stop before "#book-form" — its <select> always lists every room (the
    // direct-booking entry point deliberately isn't filtered by a search),
    // so slicing any further would make every room name "appear" here.
    const suggestions = html.split('id="suggestions-heading"')[1]?.split('<section id="book-form"')[0] ?? "";
    expect(suggestions).toContain("Copland G027");
    expect(suggestions).not.toContain("Hanna Neumann");
    expect(suggestions).not.toContain("Marie Reay");

    // this was a search, not a booking — confirm the room's own board entry
    // wasn't touched by checking a suggestion link, not a submission, is what
    // pre-selects it.
    const preselect = await fetch(new URL(`/?room=${COPLAND_ROOM_ID}`, baseUrl));
    const preselectHtml = await preselect.text();
    const option = preselectHtml.match(new RegExp(`<option value="${COPLAND_ROOM_ID}"[^>]*>`))?.[0];
    expect(option).toContain("selected");
  });

  it("an end-before-start error keeps the selected room instead of resetting it to 'Not sure'", async () => {
    const base = Date.now() + Number(process.hrtime.bigint() % 1_000_000n) * 60_000 + 15 * 60 * 60_000;
    const start = new Date(base).toISOString().slice(0, 16);
    const end = new Date(base - 30 * 60_000).toISOString().slice(0, 16); // before start: invalid range

    const res = await post("/api/bookings", bookingForm({ startsAt: start, endsAt: end }));
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "", baseUrl);
    expect(location.searchParams.get("error")).toBe("invalid_range");
    // the room the visitor had picked must survive the bounce back to "/" —
    // it used to get dropped, resetting the <select> to its placeholder.
    expect(location.searchParams.get("room")).toBe(String(ROOM_ID));

    const page = await fetch(new URL(`${location.pathname}${location.search}${location.hash}`, baseUrl));
    const html = await page.text();
    const option = html.match(new RegExp(`<option value="${ROOM_ID}"[^>]*>`))?.[0];
    expect(option).toContain("selected");
  });

  it("rejects a search where the minimum seat count is greater than the maximum", async () => {
    const base = Date.now() + Number(process.hrtime.bigint() % 1_000_000n) * 60_000 + 16 * 60 * 60_000;
    const start = new Date(base).toISOString().slice(0, 16);
    const end = new Date(base + 60 * 60_000).toISOString().slice(0, 16);

    const res = await post(
      "/api/bookings",
      new URLSearchParams({
        roomId: "",
        startsAt: start,
        endsAt: end,
        minSeats: "10",
        maxSeats: "5",
      }),
    );
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "", baseUrl);
    expect(location.searchParams.get("error")).toBe("bad_seats");
    // both seat fields survive the bounce back to the search form.
    expect(location.searchParams.get("minSeats")).toBe("10");
    expect(location.searchParams.get("maxSeats")).toBe("5");
  });

  it("treats wheelchair accessibility as a hard filter, never a close-match suggestion", async () => {
    // Only "Hanna Neumann 1.32" and "Copland G027" (see src/lib/db.ts) carry
    // the accessible tag; a small minSeats keeps every other seed room in
    // capacity range so this isolates the equipment filter specifically.
    const base = Date.now() + Number(process.hrtime.bigint() % 1_000_000n) * 60_000 + 17 * 60 * 60_000;
    const start = new Date(base).toISOString().slice(0, 16);
    const end = new Date(base + 60 * 60_000).toISOString().slice(0, 16);

    const res = await post(
      "/api/bookings",
      new URLSearchParams({ roomId: "", startsAt: start, endsAt: end, minSeats: "1", equipment: "accessible" }),
    );
    const location = new URL(res.headers.get("location") ?? "", baseUrl);
    const page = await fetch(new URL(`${location.pathname}${location.search}`, baseUrl));
    const html = await page.text();
    const suggestions = html.split('id="suggestions-heading"')[1]?.split('<section id="book-form"')[0] ?? "";
    expect(suggestions).toContain("Hanna Neumann");
    expect(suggestions).toContain("Copland G027");
    // a room without the required tag must not appear at all — not even as
    // a "close" match with a "Missing: Wheelchair accessible" note.
    expect(suggestions).not.toContain("CSIT N101");
    expect(suggestions).not.toContain("Marie Reay");
  });

  it("splits results into exact and close matches, naming what a close match is missing", async () => {
    // "Marie Reay 4.03" has exactly {projector, whiteboard} — an exact fit
    // for this request. "CSIT N101" (projector only) and "Hanna Neumann
    // 1.32" (whiteboard only) each qualify on capacity but are missing one
    // of the two preferred (non-hard) tags, so they're "close" matches.
    const base = Date.now() + Number(process.hrtime.bigint() % 1_000_000n) * 60_000 + 18 * 60 * 60_000;
    const start = new Date(base).toISOString().slice(0, 16);
    const end = new Date(base + 60 * 60_000).toISOString().slice(0, 16);

    // No maxSeats given deliberately — this isolates the equipment matching
    // from the capacity-overshoot ranking signal, which is covered by the
    // "close matches" reasons directly instead.
    const res = await post(
      "/api/bookings",
      new URLSearchParams([
        ["roomId", ""],
        ["startsAt", start],
        ["endsAt", end],
        ["minSeats", "1"],
        ["equipment", "projector"],
        ["equipment", "whiteboard"],
      ]),
    );
    const location = new URL(res.headers.get("location") ?? "", baseUrl);
    const page = await fetch(new URL(`${location.pathname}${location.search}`, baseUrl));
    const html = await page.text();
    const suggestions = html.split('id="suggestions-heading"')[1]?.split('<section id="book-form"')[0] ?? "";

    const exactSection = suggestions.split("Exact matches")[1]?.split("Close matches")[0] ?? "";
    const closeSection = suggestions.split("Close matches")[1] ?? "";
    expect(exactSection).toContain("Marie Reay 4.03");
    expect(closeSection).toContain("CSIT N101");
    expect(closeSection).toMatch(/Missing:\s*Whiteboard/);
    expect(closeSection).not.toContain("Marie Reay 4.03");
  });
});
