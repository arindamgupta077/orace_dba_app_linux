import { NextResponse } from "next/server";

import { createAppUser, listAppUsers } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { AppUserRole } from "@/types/dba";

export const dynamic = "force-dynamic";

interface CreateUserBody {
  username?: string;
  email?: string;
  role?: AppUserRole;
  initialPassword?: string;
  isActive?: boolean;
}

async function requireAdmin() {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  }
  if (session.user.role !== "admin") {
    return { session: null, response: NextResponse.json({ message: "Admin role required." }, { status: 403 }) };
  }
  return { session, response: null };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    const users = await listAppUsers();
    return NextResponse.json({ users });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin user list error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    const body = (await request.json()) as CreateUserBody;
    const user = await createAppUser({
      username: String(body.username || ""),
      email: String(body.email || ""),
      role: String(body.role || "operator") as AppUserRole,
      initialPassword: String(body.initialPassword || ""),
      isActive: body.isActive !== false
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin user create error.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
