import type { APIRoute } from "astro";
import type { Booking } from "../../lib/db";
import { bus } from "../../lib/events";

// The minimal server-sent-events (SSE) pattern: a long-lived streaming
// response the browser consumes with `new EventSource("/api/events")`. Two
// people staring at the booking board should see each other's bookings land
// without a refresh — SSE is the simplest live channel that works everywhere
// for that; reach for WebSockets only when the client needs to push back
// over the same connection.
export const GET: APIRoute = () => {
  let onBooking: (booking: Booking) => void;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<string>({
    start(controller) {
      // an opening comment so the client (and the post-deploy CI probe) sees
      // bytes immediately, and a periodic one so proxies don't drop the
      // connection as idle
      controller.enqueue(": connected\n\n");
      heartbeat = setInterval(() => controller.enqueue(": ping\n\n"), 30_000);
      onBooking = (booking) => {
        controller.enqueue(`data: ${JSON.stringify(booking)}\n\n`);
      };
      bus.on("booking", onBooking);
    },
    cancel() {
      clearInterval(heartbeat);
      bus.off("booking", onBooking);
    },
  });

  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
};
