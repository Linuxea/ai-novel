import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { isAIConfigured } from "@/env";
import { getModel } from "@/lib/ai/client";
import { buildChapterSummaryPrompt } from "@/lib/ai/summary";
import {
  getProject,
  hashContent,
  listChapters,
  readChapterContent,
  updateChapterSummary,
} from "@/lib/storage";

type Params = {
  params: Promise<{ id: string; chapterId: string }>;
};

export const runtime = "nodejs";
export const maxDuration = 60;

/** 生成（或刷新）章节摘要并服务端落盘。基于正文 hash 幂等：内容未变则跳过 LLM 调用。 */
export async function POST(req: NextRequest, { params }: Params) {
  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "尚未配置 AI，请在 .env.local 中设置后重启。" },
      { status: 503 },
    );
  }

  const { id, chapterId } = await params;
  const force = req.nextUrl.searchParams.get("force") === "1";

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
      { error: "正文为空，无法生成摘要" },
      { status: 400 },
    );
  }

  const contentHash = hashContent(content);

  // 幂等：内容未变且非强制，直接复用已有摘要
  if (!force && chapter.summary && chapter.summaryOfContentHash === contentHash) {
    return NextResponse.json({
      summary: chapter.summary,
      contentHash,
      cached: true,
    });
  }

  try {
    const result = await generateText({
      model: getModel(project.aiModel || undefined),
      system: buildChapterSummaryPrompt(project, chapter),
      prompt: content,
      temperature: 0.3,
    });
    const summary = result.text.trim();
    await updateChapterSummary(id, chapterId, summary, contentHash);
    return NextResponse.json({ summary, contentHash, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: `摘要生成失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
