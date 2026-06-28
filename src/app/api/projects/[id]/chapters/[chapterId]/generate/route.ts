import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { isAIConfigured } from "@/env";
import { getModel } from "@/lib/ai/client";
import {
  buildWriterPrompt,
  PREV_CONTENT_TAIL_LIMIT,
  type PrevChapterContext,
} from "@/lib/ai/writer-prompt";
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

type GenerateMode = "continue" | "regenerate";

/** 流式生成章节正文（纯文本流） */
export async function POST(req: NextRequest, { params }: Params) {
  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "尚未配置 AI，请在 .env.local 中设置后重启。" },
      { status: 503 },
    );
  }

  const { id, chapterId } = await params;

  const modeParam = req.nextUrl.searchParams.get("mode");
  const mode: GenerateMode =
    modeParam === "regenerate" ? "regenerate" : "continue";

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

  // regenerate：从零生成，忽略磁盘已有正文；continue：续写
  const existing =
    mode === "regenerate" ? "" : await readChapterContent(id, chapterId);

  // 组装最近 3 章前文上下文（大纲 + 正文末尾节选）
  const prevChapters = chapters
    .filter((c) => c.order < chapter.order)
    .sort((a, b) => a.order - b.order)
    .slice(-3);
  const prevContexts: PrevChapterContext[] = await Promise.all(
    prevChapters.map(async (c) => {
      const full = await readChapterContent(id, c.id);
      const tail =
        full.length > PREV_CONTENT_TAIL_LIMIT
          ? full.slice(-PREV_CONTENT_TAIL_LIMIT)
          : full;
      return {
        order: c.order,
        title: c.title,
        outline: c.outline ?? "",
        contentTail: tail,
      };
    }),
  );

  let result;
  try {
    result = streamText({
      model: getModel(project.aiModel || undefined),
      system: buildWriterPrompt(
        data,
        chapter,
        existing,
        chapters,
        prevContexts,
      ),
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
