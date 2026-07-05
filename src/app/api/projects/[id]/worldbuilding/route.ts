import { NextRequest, NextResponse } from "next/server";
import { createWorldSection, listWorldSections } from "@/lib/storage";
import { CreateWorldSectionSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

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
    const section = await createWorldSection(id, body);
    return NextResponse.json({ section }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
