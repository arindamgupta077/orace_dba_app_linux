import { NextResponse } from "next/server";

import { listAppUsers } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { AppUserRole } from "@/types/dba";

export const dynamic = "force-dynamic";

function isUserRole(value: string): value is AppUserRole {
  return value === "app_admin" || value === "dba_admin" || value === "client" || value === "auditor";
}

export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }
    if (session.user.role !== "app_admin") {
      return NextResponse.json({ message: "App admin role required." }, { status: 403 });
    }

    const url = new URL(request.url);
    const role = (url.searchParams.get("role") || "").trim().toLowerCase();
    if (role && !isUserRole(role)) {
      return NextResponse.json({ message: "Invalid role filter." }, { status: 400 });
    }

    const users = await listAppUsers();
    const filtered = role ? users.filter((user) => user.role === role) : users;
    return NextResponse.json({ users: filtered });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load users.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
