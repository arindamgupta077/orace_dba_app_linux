import { NextResponse } from "next/server";

import { deleteDataPumpImpdpTemplate } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "Template ID is required." }, { status: 400 });
    }

    const deleted = await deleteDataPumpImpdpTemplate(id);
    return NextResponse.json({ success: deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete IMPDP template.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
