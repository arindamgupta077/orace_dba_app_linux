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
    return NextResponse.json({ status: "ok", decision, reply: text.trim() || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error resuming workflow.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function extractReply(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as Record<string, unknown>;
    if (first && typeof first === "object") {
      for (const key of ["reply", "message", "text", "output", "ai_summary", "result"]) {
        if (typeof first[key] === "string") return first[key] as string;
      }
      const jsonField = first.json as Record<string, unknown> | undefined;
      if (jsonField && typeof jsonField === "object") {
        for (const key of ["reply", "message", "text", "output", "ai_summary", "result"]) {
          if (typeof jsonField[key] === "string") return jsonField[key] as string;
        }
      }
    }
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["reply", "message", "text", "output", "ai_summary", "result"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
  }
  return null;
}
