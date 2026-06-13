/**
 * POST /api/chat/approval
 *
 * Inbound endpoint called by n8n when a generated SQL query is flagged as
 * unsafe (DDL / DML).  n8n's "send the query for approval" HTTP node POSTs
 * here with the sql_query and a resume_url so the app can later resume the
 * Wait node once the user approves or rejects.
 *
 * Expected body from n8n:
 * {
 *   "session_id": "chat-1234567890-1234",
 *   "sql_query":  "ALTER TABLE employees ADD COLUMN salary NUMBER",
 *   "resume_url": "http://localhost:5678/webhook/xxx/resume"
 * }
 */

import { NextResponse } from "next/server";
import { pendingApprovals, pruneOldApprovals } from "@/lib/server/chat-approval-store";
import type { ChatApprovalCallbackPayload } from "@/types/dba";

export async function POST(request: Request) {
  let body: ChatApprovalCallbackPayload;
  try {
    body = (await request.json()) as ChatApprovalCallbackPayload;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = (body.session_id || "").trim();
  const sqlQuery = (body.sql_query || "").trim();
  const resumeUrl = (body.resume_url || "").trim();

  if (!sessionId || !sqlQuery || !resumeUrl) {
    return NextResponse.json(
      { message: "session_id, sql_query, and resume_url are all required." },
      { status: 400 }
    );
  }

  pruneOldApprovals();

  pendingApprovals.set(sessionId, {
    sessionId,
    sqlQuery,
    resumeUrl,
    receivedAt: Date.now()
  });

  return NextResponse.json({ status: "received", session_id: sessionId });
}
