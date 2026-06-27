import { NextRequest, NextResponse } from "next/server";
import { deleteWorldSection, upsertWorldSection } from "@/lib/storage";

type Params = { params: Promise<{ id: string; sectionId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, sectionId } = await params;
  const body = await req.json().catch(() => ({}));
  const section = await upsertWorldSection(id, { ...body, id: sectionId });
  return NextResponse.json({ section });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, sectionId } = await params;
  await deleteWorldSection(id, sectionId);
  return NextResponse.json({ success: true });
}
