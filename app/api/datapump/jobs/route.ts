import { NextResponse } from "next/server";

import { notifyDataPumpJob } from "@/lib/server/datapump-events";
import { listActiveDataPumpJobs, listDataPumpJobHistory, upsertDataPumpJobHistory } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { DataPumpJob } from "@/types/dba";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const db = searchParams.get("db") || undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 500) : 100;

    const [active, history] = await Promise.all([
      listActiveDataPumpJobs(db),
      listDataPumpJobHistory(limit, db)
    ]);

    return NextResponse.json({ active, history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Data Pump jobs.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const job = (await request.json()) as DataPumpJob;
    if (!job.id || !job.operation || !job.db) {
      return NextResponse.json({ message: "Job ID, operation, and db are required." }, { status: 400 });
    }

    const updatedJob: DataPumpJob = {
      ...job,
      requested_by: job.requested_by || session.user.username || "dba"
    };

    await upsertDataPumpJobHistory(updatedJob);

    notifyDataPumpJob({
      job_id: updatedJob.id,
      status: updatedJob.status,
      action: updatedJob.operation,
      dump_file: updatedJob.dump_file,
      transfer_status: updatedJob.transfer_status,
      message: updatedJob.message
    });

    return NextResponse.json({ job: updatedJob }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record Data Pump job.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
