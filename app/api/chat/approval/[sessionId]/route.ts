/**
 * GET  /api/chat/approval/[sessionId]
 *   - Frontend polls this while waiting for an approval request from n8n.
 *   - Returns { status: "pending", sql_query } when n8n has sent a query,
 *     or { status: "none" } when no pending approval exists yet.
 *
 * POST /api/chat/approval/[sessionId]
 *   - Frontend submits the user's decision.
 *   - Body: { decision: "approved" | "rejected", sql_query: "..." }
 *   - Calls n8n's resume_url to resume the Wait node, passing the (possibly
 *     edited) SQL and the user's decision.
 */

import { NextResponse } from "next/server";
import { pendingApprovals } from "@/lib/server/chat-approval-store";
import { requireAuthenticatedSession } from "@/lib/server/session";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// ---------------------------------------------------------------------------
// GET — poll for a pending approval
// ---------------------------------------------------------------------------
export async function GET(_request: Request, context: RouteParams) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const pending = pendingApprovals.get(sessionId);

  if (!pending) {
    return NextResponse.json({ status: "none" });
  }

  return NextResponse.json({
    status: "pending",
    session_id: pending.sessionId,
    sql_query: pending.sqlQuery
  });
}

// ---------------------------------------------------------------------------
// POST — submit approval / rejection decision
// ---------------------------------------------------------------------------
interface DecisionBody {
  decision?: "approved" | "rejected";
  sql_query?: string;
}

export async function POST(request: Request, context: RouteParams) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const pending = pendingApprovals.get(sessionId);

  if (!pending) {
    return NextResponse.json(
      { message: "No pending approval found for this session." },
      { status: 404 }
    );
  }

  let body: DecisionBody;
  try {
    body = (await request.json()) as DecisionBody;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  const decision = body.decision;
  const sqlQuery = (body.sql_query || pending.sqlQuery).trim();

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { message: "decision must be 'approved' or 'rejected'." },
      { status: 400 }
    );
  }

  // Remove the pending entry so subsequent polls return "none".
  pendingApprovals.delete(sessionId);

  // Resume the n8n Wait node by calling its webhook resume URL.
  try {
    const resumeResponse = await fetch(pending.resumeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        sql_query: sqlQuery,
        approved_by: session.user.username,
        session_id: sessionId
      }),
      cache: "no-store"
    });

    if (!resumeResponse.ok) {
      let msg = resumeResponse.statusText;
      try {
        const err = (await resumeResponse.json()) as { message?: string };
        if (err.message) msg = err.message;
      } catch {
        // ignore
      }
      return NextResponse.json(
        { message: `Failed to resume n8n workflow: ${msg}` },
        { status: 502 }
      );
    }

    // If n8n responds immediately with the query result, forward it.
    const contentType = resumeResponse.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = (await resumeResponse.json()) as unknown;
      return NextResponse.json({ status: "ok", decision, reply: extractReply(json) });
    }

    const text = await resumeResponse.text();
    const cleanText = text.trim();
    const finalReply = isControlMessage(cleanText) ? null : (cleanText || null);
    return NextResponse.json({ status: "ok", decision, reply: finalReply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error resuming workflow.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function isControlMessage(str: string): boolean {
  const s = str.trim().toLowerCase();
  return (
    s === "workflow resumed" ||
    s === "node executed" ||
    s === "workflow was started" ||
    s.includes("workflow resumed") ||
    s.includes("node executed successfully")
  );
}

function extractReply(value: unknown): string | null {
  if (typeof value === "string") {
    return isControlMessage(value) ? null : value || null;
  }

  const checkObject = (obj: Record<string, unknown>): string | null => {
    // 1. Explicitly check for outcome === "blocked"
    if (obj.outcome === "blocked") {
      const msg = obj.message || obj.text || obj.reason || obj.output || obj.reply;
      if (typeof msg === "string" && msg.trim()) {
        return msg.trim();
      }
    }

    // 2. Unwrap n8n { json: { ... } } envelope if present
    const jsonField = (obj.json && typeof obj.json === "object" ? obj.json : null) as Record<string, unknown> | null;
    if (jsonField) {
      if (jsonField.outcome === "blocked") {
        const msg = jsonField.message || jsonField.text || jsonField.reason || jsonField.output || jsonField.reply;
        if (typeof msg === "string" && msg.trim()) {
          return msg.trim();
        }
      }
    }

    // 3. Extract text from json envelope first, then outer object
    const target = jsonField || obj;
    for (const key of ["text", "output", "reply", "ai_summary", "result", "message"]) {
      if (typeof target[key] === "string") {
        const val = (target[key] as string).trim();
        if (val && !isControlMessage(val)) return val;
      }
    }

    if (jsonField) {
      for (const key of ["text", "output", "reply", "ai_summary", "result", "message"]) {
        if (typeof obj[key] === "string") {
          const val = (obj[key] as string).trim();
          if (val && !isControlMessage(val)) return val;
        }
      }
    }

    return null;
  };

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as Record<string, unknown>;
    if (first && typeof first === "object") {
      return checkObject(first);
    }
    return null;
  }

  if (value && typeof value === "object") {
    return checkObject(value as Record<string, unknown>);
  }

  return null;
}
