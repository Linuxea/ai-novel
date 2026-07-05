import { NextRequest, NextResponse } from "next/server";
import { deleteWorldSection, updateWorldSection } from "@/lib/storage";
import { UpdateWorldSectionSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

type Params = { params: Promise<{ id: string; sectionId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, sectionId } = await params;
  try {
    const body = await parseJson(req, UpdateWorldSectionSchema);
    const section = await updateWorldSection(id, sectionId, body);
    return NextResponse.json({ section });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, sectionId } = await params;
  try {
    await deleteWorldSection(id, sectionId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
