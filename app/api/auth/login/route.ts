import { NextResponse } from "next/server";

import {
  clearFailedLogin,
  createSession,
  findUserForLogin,
  insertAuditLog,
  registerFailedLogin
} from "@/lib/server/repository";
import { hashPassword, safeEqual } from "@/lib/server/security";
import { setSessionCookie } from "@/lib/server/session";
import type { UserSession } from "@/types/dba";

interface LoginBody {
  username?: string;
  password?: string;
  remember?: boolean;
}

function getClientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return headers.get("x-real-ip")?.trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginBody;
    const username = (body.username || "").trim();
    const password = body.password || "";
    const rememberSession = Boolean(body.remember);

    if (!username) {
      return NextResponse.json({ message: "Username is required." }, { status: 400 });
    }

    const userRecord = await findUserForLogin(username);
    if (!userRecord || !userRecord.isActive) {
      await insertAuditLog({
        actor: username,
        action: "login",
        status: "failed",
        detail: "Invalid username or disabled account.",
        metadata: { auth_mode: "jwt" }
      });
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    if (userRecord.lockedUntil && userRecord.lockedUntil.getTime() > Date.now()) {
      await insertAuditLog({
        actor: userRecord.username,
        action: "login",
        status: "locked",
        detail: "Account is temporarily locked due to repeated failed login attempts.",
        metadata: { locked_until: userRecord.lockedUntil.toISOString(), auth_mode: "jwt" }
      });

      return NextResponse.json(
        {
          message: `Account is locked until ${userRecord.lockedUntil.toISOString()}.`
        },
        { status: 423 }
      );
    }

    const isValid =
      Boolean(password) &&
      safeEqual(hashPassword(password, userRecord.passwordSalt), userRecord.passwordHash);

    if (!isValid) {
      await registerFailedLogin(userRecord.userId);
      await insertAuditLog({
        actor: userRecord.username,
        action: "login",
        status: "failed",
        detail: "Invalid credentials provided.",
        metadata: { auth_mode: "jwt" }
      });
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    await clearFailedLogin(userRecord.userId);
    const session = await createSession(
      userRecord.userId,
      "jwt",
      rememberSession,
      getClientIp(request.headers),
      request.headers.get("user-agent") || undefined
    );

    const user: UserSession = {
      username: userRecord.username,
      userId: userRecord.userId,
      authMode: "jwt",
      role: userRecord.role
    };

    await insertAuditLog({
      actor: userRecord.username,
      action: "login",
      status: "success",
      detail: "Login successful.",
      metadata: { remember_session: rememberSession }
    });

    const response = NextResponse.json({
      user,
      expiresAt: session.expiresAt
    });
    setSessionCookie(response, session.rawToken, session.expiresAt);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected authentication error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
