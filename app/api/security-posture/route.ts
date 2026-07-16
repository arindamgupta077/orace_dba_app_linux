import { NextResponse } from "next/server";

import {
  createSecurityPostureReport,
  getActiveSecurityPostureReport,
  insertAuditLog,
  updateSecurityPostureProcessingFailure
} from "@/lib/server/repository";
import { removeStoredSecurityPosturePdf, storeSecurityPosturePdf, triggerSecurityPostureProcessing } from "@/lib/server/security-posture";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  const databaseName = new URL(request.url).searchParams.get("database") || "";
  if (!databaseName.trim()) return NextResponse.json({ message: "database is required." }, { status: 400 });
  try {
    const report = await getActiveSecurityPostureReport(databaseName, { role: session.user.role, userId: session.userId });
    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Failed to load security posture." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  if (session.user.role !== "client") return NextResponse.json({ message: "Only Client users can upload Nessus scan reports." }, { status: 403 });

  let stored: Awaited<ReturnType<typeof storeSecurityPosturePdf>> | undefined;
  try {
    const formData = await request.formData();
    const databaseName = String(formData.get("database") || "").trim();
    const file = formData.get("file");
    if (!databaseName) throw new Error("A database must be selected before uploading.");
    if (!(file instanceof File)) throw new Error("A PDF file is required.");

    stored = await storeSecurityPosturePdf(file);
    const report = await createSecurityPostureReport({
      databaseName,
      originalFilename: stored.originalFilename,
      storedFilename: stored.storedFilename,
      filePath: stored.filePath,
      fileSize: stored.fileSize,
      mimeType: "application/pdf",
      uploadedBy: session.user.username,
      uploaderUserId: session.userId,
      uploaderRole: session.user.role
    });

    await insertAuditLog({ actor: session.user.username, action: "security_posture_upload", db: databaseName, status: "success", detail: `Uploaded Nessus report ${stored.originalFilename}.`, metadata: { report_id: report.id } });

    // The response waits only for n8n's HTTP acknowledgement, never for AI processing.
    try {
      await triggerSecurityPostureProcessing({ reportId: report.id, databaseId: report.database_id, filePath: stored.filePath });
    } catch (webhookError) {
      const message = webhookError instanceof Error ? webhookError.message : "Unable to trigger AI processing.";
      await updateSecurityPostureProcessingFailure(report.id, message);
      report.processing_status = "FAILED";
      report.error_message = message;
    }
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    if (stored) await removeStoredSecurityPosturePdf(stored.filePath);
    const message = error instanceof Error ? error.message : "Failed to upload report.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
