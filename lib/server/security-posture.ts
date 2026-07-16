import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getServerEnv } from "@/lib/server/env";
import type { OutdatedSecurityPostureNotification } from "@/lib/server/repository";

const PDF_SIGNATURE = Buffer.from("%PDF-");

export function safeOriginalFilename(filename: string) {
  const base = path.basename(filename || "nessus-report.pdf");
  return base.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").slice(0, 240) || "nessus-report.pdf";
}

export function validatePdfUpload(file: File) {
  const env = getServerEnv();
  if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
    throw new Error("Only PDF Nessus scan reports may be uploaded.");
  }
  if (file.size === 0) throw new Error("The uploaded PDF is empty.");
  if (file.size > env.securityPostureMaxUploadBytes) {
    throw new Error(`The PDF exceeds the ${Math.floor(env.securityPostureMaxUploadBytes / 1024 / 1024)} MB upload limit.`);
  }
}

export async function storeSecurityPosturePdf(file: File) {
  validatePdfUpload(file);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    throw new Error("The uploaded file is not a valid PDF.");
  }
  const uploadDir = path.resolve(getServerEnv().securityPostureUploadDir);
  await mkdir(uploadDir, { recursive: true });
  const storedFilename = `${randomUUID()}.pdf`;
  const filePath = path.join(uploadDir, storedFilename);
  await writeFile(filePath, bytes, { flag: "wx" });
  return { storedFilename, filePath, fileSize: bytes.length, originalFilename: safeOriginalFilename(file.name) };
}

export async function removeStoredSecurityPosturePdf(filePath: string) {
  await unlink(filePath).catch(() => undefined);
}

/** Confines reads to SECURITY_POSTURE_UPLOAD_DIR, even if metadata is tampered with. */
export async function readStoredSecurityPosturePdf(filePath: string) {
  const root = path.resolve(getServerEnv().securityPostureUploadDir);
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid report file path.");
  }
  return readFile(resolved);
}

/** n8n acknowledges this request, then continues processing independently. */
export async function triggerSecurityPostureProcessing(input: { reportId: number; databaseId: number; filePath: string }) {
  const env = getServerEnv();
  if (!env.securityPostureWebhookUrl) throw new Error("SECURITY_POSTURE_N8N_WEBHOOK_URL is not configured.");
  const response = await fetch(env.securityPostureWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.securityPostureWebhookToken ? { "X-Security-Posture-Token": env.securityPostureWebhookToken } : {}),
      // The deployment shares the existing admin n8n webhook. Keep its
      // established authentication contract while retaining the dedicated
      // security-posture token for a standalone workflow deployment.
      ...(env.adminWebhookSecret ? { "X-Admin-Webhook-Secret": env.adminWebhookSecret } : {})
    },
    body: JSON.stringify({ action: "process_pdf", document_id: input.reportId, database_id: input.databaseId, file_path: input.filePath }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`n8n webhook failed (${response.status}).`);
}

/** Sends the one-time overdue-report notification to the configured n8n webhook. */
export async function triggerSecurityPostureOutdatedNotification(input: OutdatedSecurityPostureNotification) {
  const env = getServerEnv();
  if (!env.securityPostureWebhookUrl) throw new Error("SECURITY_POSTURE_N8N_WEBHOOK_URL is not configured.");
  const response = await fetch(env.securityPostureWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.securityPostureWebhookToken ? { "X-Security-Posture-Token": env.securityPostureWebhookToken } : {}),
      ...(env.adminWebhookSecret ? { "X-Admin-Webhook-Secret": env.adminWebhookSecret } : {})
    },
    body: JSON.stringify({
      action: "posture_outdated",
      database_name: input.databaseName,
      database_owner_name: input.databaseOwnerName,
      database_owner_email: input.databaseOwnerEmail,
      last_upload_date: input.lastUploadDate
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`n8n webhook failed (${response.status}).`);
}
