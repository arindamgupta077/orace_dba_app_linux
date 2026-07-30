import { NextResponse } from "next/server";

import { getAppUserById, insertChangeAuditLog, removeAppUser, revokeUserSessions, toggleAppUserStatus, updateAppUser } from "@/lib/server/repository";
import { invalidateSessionCacheForUser, requireAuthenticatedSession } from "@/lib/server/session";
import type { AppUserRole } from "@/types/dba";

export const dynamic = "force-dynamic";

interface UpdateUserBody {
  username?: string;
  email?: string;
  role?: AppUserRole;
  isActive?: boolean;
}

interface RouteContext {
  params: Promise<{ userId: string }>;
}

async function requireAdmin() {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  }
  if (session.user.role !== "app_admin") {
    return { session: null, response: NextResponse.json({ message: "App admin role required." }, { status: 403 }) };
  }
  return { session, response: null };
}

async function readUserId(context: RouteContext) {
  const params = await context.params;
  const userId = Number(params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid user id.");
  }
  return userId;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    const userId = await readUserId(context);
    const body = (await request.json()) as UpdateUserBody;
    const nextRole = String(body.role || "client") as AppUserRole;
    const nextActive = body.isActive !== false;

    if (auth.session?.userId === userId && (nextRole !== "app_admin" || !nextActive)) {
      return NextResponse.json(
        { message: "You cannot remove app admin access from your own active session." },
        { status: 400 }
      );
    }

    // Fetch old user data before update for field-level diff tracking
    const oldUser = await getAppUserById(userId);

    const user = await updateAppUser({
      userId,
      username: String(body.username || ""),
      email: String(body.email || ""),
      role: nextRole,
      isActive: nextActive
    });

    if (auth.session?.userId !== user.userId) {
      await revokeUserSessions(user.userId);
      invalidateSessionCacheForUser(user.userId);
    }

    // Compute field-level diffs for change audit
    if (oldUser) {
      const fieldMap: Array<{ field: string; oldVal: string; newVal: string }> = [
        { field: "username", oldVal: oldUser.username, newVal: user.username },
        { field: "email", oldVal: oldUser.email, newVal: user.email },
        { field: "role", oldVal: oldUser.role, newVal: user.role },
        { field: "is_active", oldVal: String(oldUser.isActive), newVal: String(user.isActive) }
      ];
      const changes = fieldMap
        .filter((f) => f.oldVal !== f.newVal)
        .map((f) => ({ field: f.field, oldValue: f.oldVal, newValue: f.newVal }));

      if (changes.length > 0) {
        await insertChangeAuditLog({
          entityType: "APP_USER",
          entityId: user.userId,
          entityName: user.username,
          action: "UPDATE",
          changedBy: auth.session!.user.username,
          changes
        });
      }
    }

    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin user update error.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    const userId = await readUserId(context);
    if (auth.session?.userId === userId) {
      return NextResponse.json(
        { message: "You cannot delete your own app admin account." },
        { status: 400 }
      );
    }

    // Fetch user info before deletion for audit
    const oldUser = await getAppUserById(userId);

    await revokeUserSessions(userId);
    invalidateSessionCacheForUser(userId);
    await removeAppUser(userId);

    await insertChangeAuditLog({
      entityType: "APP_USER",
      entityId: userId,
      entityName: oldUser?.username || String(userId),
      action: "DELETE",
      changedBy: auth.session!.user.username,
      changeSummary: `Deleted user "${oldUser?.username || userId}" (${oldUser?.email || "unknown"})`
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin user delete error.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function PUT(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    const userId = await readUserId(context);
    if (auth.session?.userId === userId) {
      return NextResponse.json(
        { message: "You cannot toggle your own account status." },
        { status: 400 }
      );
    }

    const user = await toggleAppUserStatus(userId);

    if (!user.isActive) {
      await revokeUserSessions(user.userId);
      invalidateSessionCacheForUser(user.userId);
    }

    await insertChangeAuditLog({
      entityType: "APP_USER",
      entityId: user.userId,
      entityName: user.username,
      action: "TOGGLE_STATUS",
      changedBy: auth.session!.user.username,
      changes: [{
        field: "is_active",
        oldValue: user.isActive ? "false" : "true",
        newValue: String(user.isActive)
      }],
      changeSummary: `Toggled user "${user.username}" status to ${user.isActive ? "active" : "inactive"}`
    });

    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected status toggle error.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
