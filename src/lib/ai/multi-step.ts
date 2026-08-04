import "server-only";
import { generateObject, streamText } from "ai";
import { getModel } from "@/lib/ai/client";
import {
  BeatSheetSchema,
  type Beat,
  type BeatSheet,
  type Project,
} from "@/lib/types";
import {
  readBeatSheet,
  writeBeatSheet,
} from "@/lib/storage";
import {
  assembleContextBundle,
  buildSharedContext,
  buildWriterPrompt,
  type ContextBundle,
} from "@/lib/ai/writer-prompt";
import {
  classifyDuePlotNotes,
  hasUrgentDue,
  renderDueSection,
} from "@/lib/plot-due";
import type { RagHit } from "@/lib/rag/chunk";

interface ChapterRef {
  title: string;
  outline: string;
  order: number;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/** beat 规划的 system 提示词（含设定 + 前情 + 到期伏笔） */
function buildBeatSheetPrompt(
  bundle: ContextBundle,
  chapter: ChapterRef,
  existing: string,
): string {
  const due = classifyDuePlotNotes(bundle.plotNotes, chapter.order);
  const showDue = hasUrgentDue(due) || due.approaching.length > 0;
  const dueBlock = showDue
    ? `\n\n# 本章需处理的伏笔\n${renderDueSection(due, chapter.order)}`
    : "";

  return `你是一位资深小说结构师，正在为《${bundle.project.title}》第${chapter.order}章《${chapter.title}》规划写作结构（beat sheet / 分镜）。

${buildSharedContext(bundle, chapter.order)}${dueBlock}

# 当前任务
把本章拆成 3-8 个 beat（叙事单元：场景 / 转折 / 情绪点）。每个 beat 包含：summary（本 beat 发生什么，1-2 句）、targetWords（目标字数，各 beat 合计接近本章预期总长，约 3000 字）、plotHooks（本 beat 要埋/收的伏笔标题，从上方"本章需处理的伏笔"中选取）。

# 要求
1. ${existing.trim() ? "本章为续写，第一个 beat 应承接已有正文末尾，不要重述。" : "本章为开篇或重写，第一个 beat 应自然引入。"}
2. 各 beat 之间有清晰的场景或情绪推进，避免内容重复。
3. 把"必须回收 / 必须埋下"的伏笔分配到具体 beat 的 plotHooks，不要集中在一处。
4. overallArc 用一句话概括本章的情绪 / 情节弧线。
请严格按 schema 输出。`;
}

/** 单 beat 扩写的 system 提示词 */
function buildExpandBeatPrompt(
  bundle: ContextBundle,
  beat: Beat,
  chapter: ChapterRef,
  prevSummaries: string[],
  accumulatedTail: string,
): string {
  const hooks = beat.plotHooks?.length
    ? `\n本段需自然织入的伏笔：${beat.plotHooks.join("、")}（通过场景/对话/物件让伏笔"发生"，禁止生硬塞入）`
    : "";
  const mood = beat.mood ? `\n情绪基调：${beat.mood}` : "";
  const prevBlock = prevSummaries.length
    ? `\n\n# 前面已写段落概要\n${prevSummaries.join("；")}`
    : "";

  return `你是一位才华横溢的中文小说作家，正在为《${bundle.project.title}》第${chapter.order}章撰写其中一个段落。

${buildSharedContext(bundle, chapter.order)}
${prevBlock}

# 当前任务
撰写本章第 ${beat.index} 段。
本段规划：${beat.summary}
目标字数：约 ${beat.targetWords} 字。${hooks}${mood}

# 衔接
紧接以下已有内容续写，不要重复：
"""
${accumulatedTail || "（本段为本章开头）"}
"""

# 要求
1. 只写这一个段落，尽量达到目标字数。
2. 紧接前文，自然过渡，不得重复已有内容。
3. 直接输出正文，不要加标题、编号或任何解释。`;
}

/** 单次生成的 Response（多步降级 / strategy=single 时复用） */
function singleResponse(
  bundle: ContextBundle,
  chapter: ChapterRef,
  existing: string,
  project: Project,
  ragHits: RagHit[] | undefined,
  signal: AbortSignal | undefined,
): Response {
  const result = streamText({
    model: getModel(project.aiModel || undefined),
    system: buildWriterPrompt(bundle, chapter, existing, ragHits),
    temperature: project.temperature ?? 0.85,
    prompt: "请开始撰写本章正文。",
    abortSignal: signal,
  });
  return result.toTextStreamResponse();
}

export interface MultiStepOpts {
  projectId: string;
  chapterId: string;
  bundle: ContextBundle;
  chapter: ChapterRef;
  existing: string;
  mode: "continue" | "regenerate";
  project: Project;
  ragHits?: RagHit[];
  signal?: AbortSignal;
}

/**
 * 多步生成：beat 规划（generateObject）→ 逐 beat 扩写（streamText）→ 聚合成单条文本流。
 * beat 规划失败则无缝降级为单次生成。返回最终 Response。
 */
export async function streamMultiStep(opts: MultiStepOpts): Promise<Response> {
  const signal = opts.signal;

  // 1. beat 规划（continue 复用缓存；regenerate 重新规划）
  let sheet: BeatSheet | null = null;
  try {
    if (opts.mode === "continue") {
      sheet = await readBeatSheet(opts.projectId, opts.chapterId);
    }
    if (!sheet) {
      const res = await generateObject({
        model: getModel(opts.project.aiModel || undefined),
        schema: BeatSheetSchema,
        system: buildBeatSheetPrompt(opts.bundle, opts.chapter, opts.existing),
        temperature: 0.4,
        prompt: "请规划本章分镜（beat sheet）。",
        abortSignal: signal,
      });
      sheet = res.object;
      await writeBeatSheet(opts.projectId, opts.chapterId, sheet);
    }
  } catch (e) {
    if (isAbort(e)) throw e;
    // beat 失败：降级单次
    return singleResponse(
      opts.bundle,
      opts.chapter,
      opts.existing,
      opts.project,
      opts.ragHits,
      signal,
    );
  }

  const sheetFinal: BeatSheet = sheet;
  const enc = new TextEncoder();
  const model = getModel(opts.project.aiModel || undefined);
  const temperature = opts.project.temperature ?? 0.85;

  // 2. 逐 beat 扩写，聚合成单条文本流
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = opts.mode === "continue" ? opts.existing : "";
      const prevSummaries: string[] = [];
      try {
        for (let i = 0; i < sheetFinal.beats.length; i++) {
          const beat = sheetFinal.beats[i];
          const tail = accumulated.slice(-800);
          const result = streamText({
            model,
            system: buildExpandBeatPrompt(
              opts.bundle,
              beat,
              opts.chapter,
              prevSummaries,
              tail,
            ),
            temperature,
            prompt: `请扩写第 ${i + 1} 段（目标约 ${beat.targetWords} 字），直接输出正文。`,
            abortSignal: signal,
          });
          let beatText = "";
          for await (const chunk of result.textStream) {
            beatText += chunk;
            controller.enqueue(enc.encode(chunk));
          }
          accumulated += beatText;
          prevSummaries.push(beat.summary);
        }
      } catch (e) {
        if (!isAbort(e)) {
          controller.enqueue(
            enc.encode(`\n\n[生成中断：${(e as Error).message}]`),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export { assembleContextBundle };
