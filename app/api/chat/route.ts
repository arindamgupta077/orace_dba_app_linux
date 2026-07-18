import { NextResponse } from "next/server";

import { getDatabaseTargetByName } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
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

    // n8n responds with the humanised text from the final LLM node.
    // Accept both plain-text and JSON-wrapped responses.
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = (await response.json()) as unknown;
      return NextResponse.json({ reply: extractReply(json), session_id: sessionId });
    }

    const text = await response.text();
    return NextResponse.json({ reply: text.trim(), session_id: sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error contacting n8n.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractReply(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as Record<string, unknown>;
    if (first && typeof first === "object") {
      for (const key of ["reply", "message", "text", "output", "ai_summary", "result"]) {
        if (typeof first[key] === "string") return first[key] as string;
      }
      // Unwrap n8n { json: { ... } } envelope
      const jsonField = first.json as Record<string, unknown> | undefined;
      if (jsonField && typeof jsonField === "object") {
        for (const key of ["reply", "message", "text", "output", "ai_summary", "result"]) {
          if (typeof jsonField[key] === "string") return jsonField[key] as string;
        }
      }
    }
    return JSON.stringify(value);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["reply", "message", "text", "output", "ai_summary", "result"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
  }
  return JSON.stringify(value);
}
