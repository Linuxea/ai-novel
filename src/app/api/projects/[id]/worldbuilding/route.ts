import { NextRequest, NextResponse } from "next/server";
import { listWorldSections } from "@/lib/storage";
import { createWorldSectionCommand } from "@/lib/application/project-commands";
import { CreateWorldSectionSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type { WorldMutationResponse } from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const sections = await listWorldSections(id);
    return NextResponse.json({ sections });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await parseJson(req, CreateWorldSectionSchema);
    const result = await createWorldSectionCommand(id, body);
    const response = result satisfies WorldMutationResponse;
    return NextResponse.json(response, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
