"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { executeDBAAction } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { DbaAction, DbaRequestPayload, DbaResponse, RequestStatus } from "@/types/dba";

export function useDbaAction() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const user = useAppStore((state) => state.user);
  const addRequestHistory = useAppStore((state) => state.addRequestHistory);
  const updateRequestHistory = useAppStore((state) => state.updateRequestHistory);
  const addAuditLog = useAppStore((state) => state.addAuditLog);
  const [status, setStatus] = useState<RequestStatus>("idle");
  const [response, setResponse] = useState<DbaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setResponse(null);
    setError(null);
  }, []);

  const runAction = useCallback(
    async (action: DbaAction, params: Record<string, unknown> = {}, db = selectedDb) => {
      const requestedBy = user?.username || "arindam";
      const id = `REQ-${Date.now()}`;
      const started = performance.now();
      const payload: DbaRequestPayload = { action, db, params, requested_by: requestedBy };

      setStatus("loading");
      setError(null);
      setResponse(null);
      addRequestHistory({
        id,
        action,
        db,
        status: "success",
        requested_by: requestedBy,
        created_at: new Date().toISOString(),
        payload
      });

      try {
        const result = await executeDBAAction(action, db, params);
        const nextStatus = result.status === "pending_approval" ? "pending_approval" : "success";
        setStatus(nextStatus);
        setResponse(result);
        updateRequestHistory(id, {
          status: result.status,
          response: result,
          duration_ms: Math.round(performance.now() - started)
        });
        addAuditLog({
          id: `AUD-${Date.now()}`,
          actor: requestedBy,
          action,
          db,
          status: result.status,
          timestamp: new Date().toISOString(),
          detail: `${action} submitted to n8n webhook for ${db}`
        });
        toast.success(result.status === "pending_approval" ? "Approval requested" : "DBA action completed", {
          description: result.request_id
        });
        return result;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Unexpected DBA action failure";
        setStatus("error");
        setError(message);
        updateRequestHistory(id, {
          status: "error",
          error: message,
          duration_ms: Math.round(performance.now() - started)
        });
        addAuditLog({
          id: `AUD-${Date.now()}`,
          actor: requestedBy,
          action,
          db,
          status: "error",
          timestamp: new Date().toISOString(),
          detail: message
        });
        toast.error("Webhook request failed", { description: message });
        throw cause;
      }
    },
    [addAuditLog, addRequestHistory, selectedDb, updateRequestHistory, user?.username]
  );

  return { runAction, status, response, error, setResponse, reset };
}
