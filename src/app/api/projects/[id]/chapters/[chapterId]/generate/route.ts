import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { isAIConfigured } from "@/env";
import { getModel } from "@/lib/ai/client";
import { buildWriterPrompt } from "@/lib/ai/writer-prompt";
import {
  getProject,
  getProjectData,
  listChapters,
  readChapterContent,
} from "@/lib/storage";

type Params = {
  params: Promise<{ id: string; chapterId: string }>;
};

export const runtime = "nodejs";
export const maxDuration = 120;

/** 流式生成章节正文（纯文本流） */
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

  const data = await getProjectData(id);
  if (!data) {
    return NextResponse.json({ error: "项目数据读取失败" }, { status: 404 });
  }
  const chapters = await listChapters(id);
  const chapter = chapters.find((c) => c.id === chapterId);
  if (!chapter) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }

  const existing = await readChapterContent(id, chapterId);

  let result;
  try {
    result = streamText({
      model: getModel(project.aiModel || undefined),
      system: buildWriterPrompt(data, chapter, existing, chapters),
      temperature: project.temperature ?? 0.85,
      prompt: "请开始撰写本章正文。",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `模型初始化失败：${(e as Error).message}` },
      { status: 500 },
    );
  }

  return result.toTextStreamResponse();
}
