import { NextRequest, NextResponse } from "next/server";
import { deleteChapter, updateChapter } from "@/lib/storage";
import { UpdateChapterSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

type Params = { params: Promise<{ id: string; chapterId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    const body = await parseJson(req, UpdateChapterSchema);
    const chapter = await updateChapter(id, chapterId, body);
    return NextResponse.json({ chapter });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    await deleteChapter(id, chapterId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
