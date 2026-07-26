import { NextResponse } from "next/server";
import { listNotificationHistory, type ListNotificationHistoryInput } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAuthenticatedSession();
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "25", 10);
  const category = (searchParams.get("category") || "all") as ListNotificationHistoryInput["category"];
  const type = (searchParams.get("type") || "all") as ListNotificationHistoryInput["type"];
  const severity = (searchParams.get("severity") || "all") as ListNotificationHistoryInput["severity"];
  const status = (searchParams.get("status") || "all") as ListNotificationHistoryInput["status"];
  const db = searchParams.get("db") || undefined;
  const dateRange = (searchParams.get("dateRange") || "all") as ListNotificationHistoryInput["dateRange"];
  const startDate = searchParams.get("startDate") || undefined;
  const endDate = searchParams.get("endDate") || undefined;
  const search = searchParams.get("search") || undefined;

  try {
    const result = await listNotificationHistory({
      page,
      pageSize,
      category,
      type,
      severity,
      status,
      db,
      dateRange,
      startDate,
      endDate,
      search
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch notification history";
    return NextResponse.json({ message }, { status: 500 });
  }
}
