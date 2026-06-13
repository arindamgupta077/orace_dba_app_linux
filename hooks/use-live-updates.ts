"use client";

import { useEffect, useState } from "react";
import type { DbaResponse } from "@/types/dba";

export function useLiveUpdates(db: string) {
  const [lastEvent, setLastEvent] = useState<Partial<DbaResponse> | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_DBA_WS_URL;
    if (!url) {
      const id = window.setInterval(() => {
        setLastEvent({
          request_id: `LIVE-${Date.now()}`,
          db_status: Math.random() > 0.75 ? "warning" : "healthy",
          ai_summary: `${db} heartbeat received from mock live monitor.`
        });
      }, 12000);
      return () => window.clearInterval(id);
    }

    const socket = new WebSocket(`${url}?db=${encodeURIComponent(db)}`);
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);
    socket.onmessage = (event) => {
      try {
        setLastEvent(JSON.parse(event.data) as Partial<DbaResponse>);
      } catch {
        setLastEvent({ request_id: `LIVE-${Date.now()}`, ai_summary: String(event.data), db_status: "unknown" });
      }
    };

    return () => socket.close();
  }, [db]);

  return { connected, lastEvent };
}