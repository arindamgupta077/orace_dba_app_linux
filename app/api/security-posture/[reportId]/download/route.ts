import { NextResponse } from "next/server";

import { getSecurityPostureReportFile } from "@/lib/server/repository";
import { readStoredSecurityPosturePdf } from "@/lib/server/security-posture";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const session = await requireAuthenticatedSession();
  if (!session) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  const reportId = Number((await params).reportId);
  if (!Number.isInteger(reportId) || reportId < 1) return NextResponse.json({ message: "Invalid report." }, { status: 400 });
  try {
    const report = await getSecurityPostureReportFile(reportId, { role: session.user.role, userId: session.userId });
    if (!report) return NextResponse.json({ message: "Report not found." }, { status: 404 });
    const file = await readStoredSecurityPosturePdf(report.filePath);
    const name = report.originalFilename.replace(/[\r\n"]/g, "_");
    return new NextResponse(file, { headers: { "Content-Type": report.mimeType, "Content-Length": String(file.byteLength), "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to download report." }, { status: 500 });
  }
}
