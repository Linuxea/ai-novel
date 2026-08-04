import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { isAIConfigured } from "@/env";
import { getModel } from "@/lib/ai/client";
import { buildChapterSummaryPrompt } from "@/lib/ai/summary";
import {
  getProject,
  readChapterDocument,
  RevisionConflictError,
  updateChapterSummary,
} from "@/lib/storage";
import { ChapterArtifactRequestSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import { buildSummaryInputFingerprint } from "@/lib/artifact-fingerprint";

const SUMMARY_PROMPT_VERSION = 2;

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
  try {
    const { expectedContentRevision, force = false } = await parseJson(
      req,
      ChapterArtifactRequestSchema,
    );
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const { chapter, content } = await readChapterDocument(id, chapterId);
    if (chapter.contentRevision !== expectedContentRevision) {
      throw new RevisionConflictError(
        expectedContentRevision,
        chapter.contentRevision,
      );
    }
    if (!content.trim()) {
      return NextResponse.json(
        { error: "正文为空，无法生成摘要" },
        { status: 400 },
      );
    }

    const contentHash = chapter.contentHash;
    const inputFingerprint = buildSummaryInputFingerprint(
      project,
      chapter,
      SUMMARY_PROMPT_VERSION,
    );
    if (
      !force &&
      chapter.summary &&
      chapter.summaryOfContentHash === contentHash &&
      chapter.summaryInputFingerprint === inputFingerprint
    ) {
      return NextResponse.json({
        summary: chapter.summary,
        contentHash,
        contentRevision: chapter.contentRevision,
        chapter,
        cached: true,
      });
    }

    const result = await generateText({
      model: getModel(project.aiModel || undefined),
      system: buildChapterSummaryPrompt(project, chapter),
      prompt: content,
      temperature: 0.3,
      abortSignal: AbortSignal.any([
        req.signal,
        AbortSignal.timeout(45_000),
      ]),
    });
    const summary = result.text.trim();
    const updated = await updateChapterSummary(
      id,
      chapterId,
      summary,
      contentHash,
      expectedContentRevision,
      inputFingerprint,
      SUMMARY_PROMPT_VERSION,
    );
    return NextResponse.json({
      summary,
      contentHash,
      contentRevision: updated.contentRevision,
      chapter: updated,
      cached: false,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
