import { addAlertNotificationListener } from "@/lib/server/alert-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeAlertType(raw?: string | null) {
  const normalized = (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
  return normalized || undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const db = url.searchParams.get("db")?.trim() || undefined;
  const alertType = normalizeAlertType(url.searchParams.get("alert_type") || url.searchParams.get("type"));
  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = addAlertNotificationListener({ db, alertType }, controller);
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
