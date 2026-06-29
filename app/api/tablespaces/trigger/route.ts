import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import { getDatabaseTargetByName } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { DbaRequestPayload } from "@/types/dba";

interface RequestBody {
  db?: string;
  params?: Record<string, unknown>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as RequestBody;
    const db = (body.db || "").trim();
    const params =
      body.params && typeof body.params === "object"
        ? body.params
        : { threshold_pct: 80, critical_pct: 90 };

    if (!db) {
      return NextResponse.json({ message: "db is required." }, { status: 400 });
    }

    const env = getServerEnv();

    if (env.mockMode) {
      await sleep(900 + Math.random() * 600);
      return NextResponse.json({ ok: true, triggered_by: "n8n" });
    }

    if (!env.webhookUrl) {
      throw new Error("DBA_WEBHOOK_URL is required when mock mode is disabled.");
    }

    const dbTarget = await getDatabaseTargetByName(db);
    const payload: DbaRequestPayload = {
      action: "tablespace_check",
      db,
      params,
      requested_by: "n8n",
      user_id: session.userId,
      environment: dbTarget?.env_label,
      os: dbTarget?.os,
      db_type: dbTarget?.db_type
    };

    const response = await fetch(env.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.webhookToken ? { "X-DBA-Token": env.webhookToken } : {})
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    if (!response.ok) {
      let errorMsg = response.statusText;
      try {
        const errBody = (await response.json()) as { message?: string };
        errorMsg = errBody.message || errorMsg;
      } catch {
        // ignore JSON parse failure
      }
      throw new Error(`n8n webhook failed (${response.status}): ${errorMsg}`);
    }

    return NextResponse.json({ ok: true, triggered_by: "n8n" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto-trigger failed.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
