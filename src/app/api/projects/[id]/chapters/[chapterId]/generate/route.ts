import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { isAIConfigured } from "@/env";
import { getModel } from "@/lib/ai/client";
import {
  assembleContextBundle,
  buildWriterPrompt,
  PREV_CONTENT_TAIL_LIMIT,
  type PrevChapterContext,
} from "@/lib/ai/writer-prompt";
import { streamMultiStep } from "@/lib/ai/multi-step";
import {
  getProject,
  getProjectData,
  listChapters,
  readChapterContent,
} from "@/lib/storage";
import { retrieveContext } from "@/lib/rag/retrieve";

type Params = {
  params: Promise<{ id: string; chapterId: string }>;
};

export const runtime = "nodejs";
export const maxDuration = 180;

type GenerateMode = "continue" | "regenerate";
type Strategy = "single" | "multi";

/** 解析生成策略：query 参数强制 > 项目配置 > auto 规则 */
function resolveStrategy(
  req: NextRequest,
  project: { generateStrategy?: string },
  mode: GenerateMode,
  existing: string,
): Strategy {
  const explicit = req.nextUrl.searchParams.get("strategy");
  if (explicit === "single") return "single";
  if (explicit === "multi") return "multi";
  const cfg = project.generateStrategy ?? "auto";
  if (cfg === "single") return "single";
  if (cfg === "multi") return "multi";
  // auto：重写走多步；续写已有大量正文走单次（避免切割已有正文）
  if (mode === "regenerate") return "multi";
  return existing.trim().length > 1500 ? "single" : "multi";
}

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

  const bundle = assembleContextBundle(data, prevContexts);

  // RAG 检索：根据本章大纲/涉及角色/待回收伏笔召回相关片段（失败降级为空）
  let ragHits;
  if (project.ragMode && project.ragMode !== "off") {
    const charNames = data.characters
      .filter((c) => chapter.characterIds?.includes(c.id))
      .flatMap((c) => [c.name, ...(c.aliases ?? [])]);
    const pendingForeshadows = data.plotNotes
      .filter((p) => p.type === "foreshadow" && p.status !== "resolved")
      .map((p) => p.title);
    try {
      ragHits = await retrieveContext(
        id,
        {
          outline: chapter.outline ?? "",
          characterNames: charNames,
          pendingForeshadowTitles: pendingForeshadows,
        },
        project.ragTopK ?? 6,
        project.ragMode === "embed" ? "embed" : "bm25",
      );
    } catch {
      ragHits = undefined;
    }
  }

  const strategy = resolveStrategy(req, project, mode, existing);

  // 多步：beat 规划 → 逐 beat 扩写 → 聚合流（beat 失败内部降级单次）
  if (strategy === "multi") {
    try {
      return await streamMultiStep({
        projectId: id,
        chapterId,
        bundle,
        chapter,
        existing,
        mode,
        project,
        ragHits,
        signal: req.signal,
      });
    } catch (e) {
      // 中断（abort）正常返回空流即可
      if ((e as Error).name === "AbortError") {
        return new Response("", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return NextResponse.json(
        { error: `多步生成失败：${(e as Error).message}` },
        { status: 500 },
      );
    }
  }

  // 单次
  let result;
  try {
    result = streamText({
      model: getModel(project.aiModel || undefined),
      system: buildWriterPrompt(bundle, chapter, existing, ragHits),
      temperature: project.temperature ?? 0.85,
      prompt: "请开始撰写本章正文。",
      abortSignal: req.signal,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `模型初始化失败：${(e as Error).message}` },
      { status: 500 },
    );
  }

  return result.toTextStreamResponse();
}
