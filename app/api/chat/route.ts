import { NextResponse } from "next/server";

import { getDatabaseTargetByName } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { pendingApprovals, pruneOldApprovals } from "@/lib/server/chat-approval-store";
import type { ChatBotPayload } from "@/types/dba";

interface RequestBody {
  query?: string;
  db?: string;
  session_id?: string;
}

export async function POST(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  const query = (body.query || "").trim();
  const db = (body.db || "").trim();
  const sessionId = (body.session_id || `chat-${Date.now()}-${Math.floor(Math.random() * 10000)}`).trim();

  if (!query) {
    return NextResponse.json({ message: "query is required." }, { status: 400 });
  }
  if (!db) {
    return NextResponse.json({ message: "db is required." }, { status: 400 });
  }

  const webhookUrl = process.env.NEXT_PUBLIC_DBA_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return NextResponse.json(
      { message: "NEXT_PUBLIC_DBA_WEBHOOK_URL is not configured." },
      { status: 500 }
    );
  }

  const dbTarget = await getDatabaseTargetByName(db, {
    role: session.user.role,
    userId: session.userId,
    enforceAccess: true
  });
  if (!dbTarget) return NextResponse.json({ message: "Database is unavailable." }, { status: 404 });

  const payload: ChatBotPayload = {
    action: "chat_bot",
    query,
    db,
    params: {},
    requested_by: session.user.username,
    user_id: session.userId,
    environment: dbTarget?.env_label,
    os: dbTarget?.os,
    db_type: dbTarget?.db_type,
    session_id: sessionId
  };

  const webhookToken = process.env.NEXT_PUBLIC_DBA_TOKEN?.trim();

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(webhookToken ? { "X-DBA-Token": webhookToken } : {})
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const err = (await response.json()) as { message?: string };
        if (err.message) message = err.message;
      } catch {
        // ignore parse errors
      }
      return NextResponse.json(
        { message: `n8n webhook failed (${response.status}): ${message}` },
        { status: 502 }
      );
    }

    // Check if n8n triggered the approval flow and stored a pending approval request
    pruneOldApprovals();
    const pending = pendingApprovals.get(sessionId);
    if (pending) {
      return NextResponse.json({
        status: "pending",
        session_id: sessionId,
        sql_query: pending.sqlQuery
      });
    }

    // n8n responds with the humanised text from the final LLM node.
    // Accept both plain-text and JSON-wrapped responses.
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = (await response.json()) as unknown;
      const extracted = extractReply(json);
      return NextResponse.json({ reply: extracted, session_id: sessionId });
    }

    const text = await response.text();
    const cleanText = text.trim();
    const finalReply = isControlMessage(cleanText) ? null : cleanText;
    return NextResponse.json({ reply: finalReply, session_id: sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error contacting n8n.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
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
