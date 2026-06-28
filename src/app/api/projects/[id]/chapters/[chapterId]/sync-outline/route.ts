import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { isAIConfigured } from "@/env";
import { getModel } from "@/lib/ai/client";
import { buildOutlineFromContentPrompt } from "@/lib/ai/writer-prompt";
import { getProject, listChapters, readChapterContent } from "@/lib/storage";

type Params = {
  params: Promise<{ id: string; chapterId: string }>;
};

export const runtime = "nodejs";
export const maxDuration = 60;

/** 根据章节正文生成大纲（非流式）。端点只生成不落盘，由客户端负责保存。 */
export async function POST(_req: NextRequest, { params }: Params) {
  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "尚未配置 AI，请在 .env.local 中设置后重启。" },
      { status: 503 },
    );
  }

  const { id, chapterId } = await params;

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const chapters = await listChapters(id);
  const chapter = chapters.find((c) => c.id === chapterId);
  if (!chapter) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }

  const content = await readChapterContent(id, chapterId);
  if (!content.trim()) {
    return NextResponse.json(
      { error: "正文为空，无法同步大纲" },
      { status: 400 },
    );
  }

  try {
    const result = await generateText({
      model: getModel(project.aiModel || undefined),
      system: buildOutlineFromContentPrompt(project, chapter),
      prompt: content,
      temperature: 0.3,
    });
    return NextResponse.json({ outline: result.text.trim() });
  } catch (e) {
    return NextResponse.json(
      { error: `大纲生成失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
