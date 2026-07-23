import { NextResponse } from "next/server";

import { getApprovalRequest, getApprovalHistory } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/admin/approvals/[id] — fetch a single request with its full history */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuthenticatedSession();
  if (!session || (session.user.role !== "app_admin" && session.user.role !== "dba_admin")) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ message: "Request ID is required." }, { status: 400 });
  }

  try {
    const [request, history] = await Promise.all([
      getApprovalRequest(id),
      getApprovalHistory(id)
    ]);

    if (!request) {
      return NextResponse.json({ message: "Approval request not found." }, { status: 404 });
    }

    return NextResponse.json({ request, history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch approval request.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
