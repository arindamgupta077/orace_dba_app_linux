import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { getServerEnv } from "@/lib/server/env";

export function normalizeUsername(username: string) {
  return username.trim().toUpperCase();
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashPassword(password: string, salt: string) {
  return sha256Hex(`${salt}:${password}`);
}

export function hashApiToken(token: string, salt: string) {
  return sha256Hex(`${salt}:${token}`);
}

export function hashSessionToken(token: string) {
  const { authSecret } = getServerEnv();
  return sha256Hex(`${authSecret}:${token}`);
}

export function generateSessionToken() {
  return randomBytes(48).toString("base64url");
}

export function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");

  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}
