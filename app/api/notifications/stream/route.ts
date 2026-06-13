import { addGlobalNotificationListener } from "@/lib/server/notification-events";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAuthenticatedSession();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = addGlobalNotificationListener(controller);
      request.signal.addEventListener("abort", unsubscribe, { once: true });
    },
    cancel() {
      unsubscribe();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
