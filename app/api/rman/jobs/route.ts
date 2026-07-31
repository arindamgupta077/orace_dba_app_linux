import { NextResponse } from "next/server";

import { listActiveRmanJobs, listRmanJobHistory, upsertRmanJobHistory } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { RmanJob } from "@/types/dba";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const db = searchParams.get("db") || undefined;

    const [active, history] = await Promise.all([
      listActiveRmanJobs(db),
      listRmanJobHistory(100, db)
    ]);

    return NextResponse.json({ active, history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load RMAN jobs.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const job = (await request.json()) as RmanJob;
    if (!job.id || !job.db) {
      return NextResponse.json({ message: "Job ID and db are required." }, { status: 400 });
    }

    const updatedJob: RmanJob = {
      ...job,
      request_id: job.request_id || job.id
    };

    await upsertRmanJobHistory(updatedJob);

    return NextResponse.json({ job: updatedJob }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record RMAN job.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
