import { NextResponse } from "next/server";

import {
  ApprovalAlreadyProcessedError,
  decideApprovalRequest
} from "@/lib/server/approval-workflow";
import { countPendingApprovals, listApprovalRequests } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/admin/approvals?status=pending&limit=50&offset=0 */
export async function GET(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session || (session.user.role !== "app_admin" && session.user.role !== "dba_admin")) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status  = searchParams.get("status")  || undefined;
  const limit   = Number(searchParams.get("limit")  || 50);
  const offset  = Number(searchParams.get("offset") || 0);
  const countOnly = searchParams.get("countOnly") === "1";

  try {
    if (countOnly) {
      const count = await countPendingApprovals();
      return NextResponse.json({ count });
    }

    const requesterUserId = session.user.role === "dba_admin" ? session.userId : undefined;
    const result = await listApprovalRequests({ status, limit, offset, requesterUserId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch approval requests.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

/** PATCH /api/admin/approvals — approve or reject a pending request */
export async function PATCH(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session || session.user.role !== "app_admin") {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  let body: { request_id?: string; decision?: string; comment?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  const { request_id, decision, comment } = body;
  if (!request_id || !decision) {
    return NextResponse.json(
      { message: "request_id and decision are required." },
      { status: 400 }
    );
  }
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { message: "decision must be 'approved' or 'rejected'." },
      { status: 400 }
    );
  }

  try {
    const result = await decideApprovalRequest({
      requestId:        request_id,
      decision:         decision as "approved" | "rejected",
      reviewerUserId:   session.userId,
      reviewerUsername: session.user.username,
      comment
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApprovalAlreadyProcessedError) {
      return NextResponse.json(
        { message: error.message },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to process approval decision.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
