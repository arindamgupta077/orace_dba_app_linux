import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  notifyDataPumpJob,
  type DataPumpCallbackPayload
} from "@/lib/server/datapump-events";
import { upsertDataPumpJobHistory } from "@/lib/server/repository";

export async function POST(req: NextRequest) {
  let body: DataPumpCallbackPayload;
  try {
    body = (await req.json()) as DataPumpCallbackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.job_id) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  try {
    await upsertDataPumpJobHistory({
      id: body.job_id,
      operation: body.action || "expdp",
      db: body.db || "DEFAULT",
      status: body.status,
      started_at: new Date().toISOString(),
      completed_at: body.status !== "running" ? new Date().toISOString() : undefined,
      dump_file: body.dump_file,
      transfer_status: body.transfer_status,
      message: body.message,
      params: {}
    });
  } catch (err) {
    console.error("[datapump/callback] Failed to update DATAPUMP_JOB_HISTORY table:", err);
  }

  notifyDataPumpJob(body);

  return NextResponse.json({ ok: true, job_id: body.job_id });
}
