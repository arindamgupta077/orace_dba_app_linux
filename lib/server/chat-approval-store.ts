import "server-only";

// ---------------------------------------------------------------------------
// In-memory store: session_id → pending approval payload
// ---------------------------------------------------------------------------
// This map lives in the Node.js process.  It works fine for a single-instance
// development setup (n8n running locally in Docker).  For multi-replica
// production deployments, replace with Redis or a DB-backed queue.
// ---------------------------------------------------------------------------

export interface PendingApproval {
  sessionId: string;
  sqlQuery: string;
  resumeUrl: string;
  receivedAt: number;
}

export const pendingApprovals = new Map<string, PendingApproval>();

const APPROVAL_TTL_MS = 30 * 60 * 1000;

export function pruneOldApprovals() {
  const now = Date.now();
  for (const [key, entry] of pendingApprovals) {
    if (now - entry.receivedAt >= APPROVAL_TTL_MS) {
      pendingApprovals.delete(key);
    }
  }
}
