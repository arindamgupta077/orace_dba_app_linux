import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  notifyDataPumpJob,
  type DataPumpCallbackPayload
} from "@/lib/server/datapump-events";

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

  notifyDataPumpJob(body);

  return NextResponse.json({ ok: true, job_id: body.job_id });
}
