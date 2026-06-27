import "server-only";

import { getServerEnv } from "@/lib/server/env";

type PasswordResetFlow = "forgot-password" | "reset-password";

interface WebhookPayload {
  email?: string;
  token?: string;
  newPassword?: string;
}

export const FORGOT_PASSWORD_RESPONSE = {
  success: true,
  message: "If the email exists, a reset link has been sent."
} as const;

export const RESET_PASSWORD_FAILURE_RESPONSE = {
  success: false,
  message: "Invalid or expired reset link."
} as const;

export interface PasswordResetWebhookResult {
  success: boolean;
  message: string;
}

export function getClientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

export function validatePassword(password: string) {
  if (password.length < 12) {
    return "Password must be at least 12 characters long.";
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "Password must include uppercase, lowercase, number, and special characters.";
  }

  return undefined;
}

function getFlowWebhookUrl(flow: PasswordResetFlow) {
  const env = getServerEnv();
  const specificUrl =
    flow === "forgot-password"
      ? process.env.ADMIN_FORGOT_PASSWORD_WEBHOOK_URL?.trim()
      : process.env.ADMIN_RESET_PASSWORD_WEBHOOK_URL?.trim();

  return specificUrl || env.adminWebhookUrl;
}

async function readWebhookJson(response: Response): Promise<PasswordResetWebhookResult | null> {
  try {
    const payload = (await response.json()) as Partial<PasswordResetWebhookResult>;
    if (typeof payload.success === "boolean" && typeof payload.message === "string") {
      return {
        success: payload.success,
        message: payload.message
      };
    }
  } catch {
    // The caller turns malformed webhook responses into a generic failure.
  }

  return null;
}

export async function postPasswordResetWebhook(
  flow: PasswordResetFlow,
  payload: WebhookPayload,
  requestHeaders: Headers
) {
  const env = getServerEnv();
  const webhookUrl = getFlowWebhookUrl(flow);

  if (!webhookUrl) {
    throw new Error("NEXT_PUBLIC_ADMIN_WEBHOOK_URL is not configured.");
  }

  if (!env.adminWebhookSecret) {
    throw new Error("ADMIN_WEBHOOK_SECRET is not configured.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Webhook-Secret": env.adminWebhookSecret
    },
    body: JSON.stringify({
      flow,
      ...payload,
      requestIp: getClientIp(requestHeaders),
      userAgent: requestHeaders.get("user-agent") || "unknown"
    }),
    cache: "no-store"
  });

  return {
    ok: response.ok,
    status: response.status,
    payload: await readWebhookJson(response)
  };
}
