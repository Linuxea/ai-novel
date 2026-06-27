import { NextRequest, NextResponse } from "next/server";
import { readChapterContent, writeChapterContent } from "@/lib/storage";

type Params = { params: Promise<{ id: string; chapterId: string }> };

/** 读取章节正文 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  const content = await readChapterContent(id, chapterId);
  return NextResponse.json({ content });
}

/** 保存章节正文 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  await writeChapterContent(id, chapterId, content);
  return NextResponse.json({ success: true, wordCount: content.replace(/\s+/g, "").length });
}
