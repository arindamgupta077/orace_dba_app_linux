import { NextResponse } from "next/server";

import {
  getUserDatabaseInventoryColumns,
  upsertUserDatabaseInventoryColumns
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    return NextResponse.json({ columns: await getUserDatabaseInventoryColumns(session.userId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load database inventory columns.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { columns?: unknown };
    if (!Array.isArray(body.columns)) {
      return NextResponse.json({ message: "columns must be an array." }, { status: 400 });
    }
    return NextResponse.json({ columns: await upsertUserDatabaseInventoryColumns(session.userId, body.columns) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save database inventory columns.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
