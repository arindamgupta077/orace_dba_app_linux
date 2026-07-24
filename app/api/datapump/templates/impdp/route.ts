import { NextResponse } from "next/server";

import { createDataPumpImpdpTemplate, listDataPumpImpdpTemplates } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { ImpdpParams } from "@/types/dba";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const templates = await listDataPumpImpdpTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load IMPDP templates.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as {
      name?: string;
      db?: string;
      params?: ImpdpParams;
    };

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ message: "Template name is required." }, { status: 400 });
    }

    if (!body.params || typeof body.params !== "object") {
      return NextResponse.json({ message: "Template parameters are required." }, { status: 400 });
    }

    const template = await createDataPumpImpdpTemplate({
      name: body.name.trim(),
      db: body.db || "",
      createdBy: session.user.username || "dba",
      params: body.params
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create IMPDP template.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
