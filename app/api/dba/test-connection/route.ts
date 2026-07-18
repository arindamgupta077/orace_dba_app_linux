import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import { requireAuthenticatedSession } from "@/lib/server/session";

interface RequestBody {
  db?: string;
}

/**
 * Lightweight endpoint that sends a `test_connection` action to the n8n
 * DBA webhook and returns the `remote_connection` value from the response.
 *
 * Request:  POST { db: "DATABASE_NAME" }
 * Response: { remote_connection: "UP" | "DOWN" }
 */
export async function POST(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as RequestBody;
    const db = (body.db || "").trim();

    if (!db) {
      return NextResponse.json({ message: "Database name is required." }, { status: 400 });
    }

    const env = getServerEnv();

    if (env.mockMode) {
      // In mock mode, return UP after a short delay
      await new Promise((r) => setTimeout(r, 600));
      return NextResponse.json({ remote_connection: "UP" });
    }

    if (!env.webhookUrl) {
      throw new Error("DBA_WEBHOOK_URL is required when mock mode is disabled.");
    }

    const payload = {
      action: "test_connection",
      db,
      params: {
        database_name: db,
        requested_by: session.user.username,
      },
      requested_by: session.user.username,
      user_id: session.userId,
    };

    const response = await fetch(env.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.webhookToken ? { "X-DBA-Token": env.webhookToken } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      let message: string;
      try {
        const errBody = (await response.json()) as { message?: string };
        message = errBody.message || response.statusText;
      } catch {
        message = response.statusText;
      }
      throw new Error(`n8n webhook failed (${response.status}): ${message}`);
    }

    const result = await response.json() as Record<string, unknown>;

    // n8n may wrap items in { json: { ... } } or return a flat object / array
    let connectionValue: string | undefined;

    if (typeof result.remote_connection === "string") {
      connectionValue = result.remote_connection;
    } else if (Array.isArray(result)) {
      for (const item of result) {
        const obj = item?.json ?? item;
        if (obj && typeof obj.remote_connection === "string") {
          connectionValue = obj.remote_connection;
          break;
        }
      }
    }

    return NextResponse.json({
      remote_connection: connectionValue?.toUpperCase() === "UP" ? "UP" : "DOWN",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
