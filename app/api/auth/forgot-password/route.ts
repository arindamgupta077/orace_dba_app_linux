import { NextResponse } from "next/server";

import {
  FORGOT_PASSWORD_RESPONSE,
  isValidEmail,
  normalizeEmail,
  postPasswordResetWebhook
} from "@/lib/server/password-reset-webhook";

interface ForgotPasswordBody {
  email?: string;
}

export async function POST(request: Request) {
  let email = "";

  try {
    const body = (await request.json()) as ForgotPasswordBody;
    email = normalizeEmail(body.email || "");
  } catch {
    return NextResponse.json({ message: "Invalid JSON request body." }, { status: 400 });
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const result = await postPasswordResetWebhook("forgot-password", { email }, request.headers);
    if (!result.ok) {
      console.error(`[forgot-password] n8n webhook returned ${result.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown forgot-password webhook error.";
    console.error(`[forgot-password] ${message}`);
  }

  return NextResponse.json(FORGOT_PASSWORD_RESPONSE);
}
