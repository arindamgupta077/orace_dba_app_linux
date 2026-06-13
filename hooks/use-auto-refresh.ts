"use client";

import { useEffect, useRef } from "react";

export function useAutoRefresh(enabled: boolean, seconds: number, callback: () => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || seconds <= 0) return undefined;
    const id = window.setInterval(() => callbackRef.current(), seconds * 1000);
    return () => window.clearInterval(id);
  }, [enabled, seconds]);
}
