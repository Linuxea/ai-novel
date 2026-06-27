import { NextRequest, NextResponse } from "next/server";
import { deleteChapter, upsertChapter } from "@/lib/storage";

type Params = { params: Promise<{ id: string; chapterId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  const body = await req.json().catch(() => ({}));
  const chapter = await upsertChapter(id, { ...body, id: chapterId });
  return NextResponse.json({ chapter });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  await deleteChapter(id, chapterId);
  return NextResponse.json({ success: true });
}
