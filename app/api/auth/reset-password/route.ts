import { NextResponse } from "next/server";

import { clearMustChangePasswordByResetToken } from "@/lib/server/repository";
import {
  postPasswordResetWebhook,
  RESET_PASSWORD_FAILURE_RESPONSE,
  validatePassword
} from "@/lib/server/password-reset-webhook";

interface ResetPasswordBody {
  token?: string;
  newPassword?: string;
}

export async function POST(request: Request) {
  let token = "";
  let newPassword = "";

  try {
    const body = (await request.json()) as ResetPasswordBody;
    token = String(body.token || "").trim();
    newPassword = String(body.newPassword || "");
  } catch {
    return NextResponse.json({ message: "Invalid JSON request body." }, { status: 400 });
  }

  if (!token || token.length < 32 || token.length > 512) {
    return NextResponse.json(RESET_PASSWORD_FAILURE_RESPONSE, { status: 400 });
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return NextResponse.json({ success: false, message: passwordError }, { status: 400 });
  }

  try {
    const result = await postPasswordResetWebhook(
      "reset-password",
      { token, newPassword },
      request.headers
    );

    if (!result.ok) {
      console.error(`[reset-password] n8n webhook returned ${result.status}`);
      return NextResponse.json(RESET_PASSWORD_FAILURE_RESPONSE, { status: 400 });
    }

    if (result.payload?.success) {
      await clearMustChangePasswordByResetToken(token);
    }

    return NextResponse.json(result.payload || RESET_PASSWORD_FAILURE_RESPONSE);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reset-password webhook error.";
    console.error(`[reset-password] ${message}`);
    return NextResponse.json(RESET_PASSWORD_FAILURE_RESPONSE, { status: 400 });
  }
}
