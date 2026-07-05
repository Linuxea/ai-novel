import { NextRequest, NextResponse } from "next/server";
import { readChapterContent, writeChapterContent } from "@/lib/storage";
import { SaveChapterContentSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

type Params = { params: Promise<{ id: string; chapterId: string }> };

/** 读取章节正文 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    const content = await readChapterContent(id, chapterId);
    return NextResponse.json({ content });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** 保存章节正文 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    const { content } = await parseJson(req, SaveChapterContentSchema);
    await writeChapterContent(id, chapterId, content);
    return NextResponse.json({
      success: true,
      wordCount: content.replace(/\s+/g, "").length,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
