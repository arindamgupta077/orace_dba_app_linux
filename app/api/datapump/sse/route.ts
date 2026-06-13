import type { NextRequest } from "next/server";
import { subscribeDataPumpJob } from "@/lib/server/datapump-events";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job_id") ?? "*";

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(keepAlive);
        }
      }, 25_000);

      const unsubscribe = subscribeDataPumpJob(jobId, (payload) => {
        try {
          const data = `data: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(enc.encode(data));
        } catch {
          // client disconnected
        }
      });

      req.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        unsubscribe();
        try { controller.close(); } catch { /* ignore */ }
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}