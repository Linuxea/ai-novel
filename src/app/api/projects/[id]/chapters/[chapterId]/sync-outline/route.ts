import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { isAIConfigured } from "@/env";
import { getModel } from "@/lib/ai/client";
import { buildOutlineSyncPrompt } from "@/lib/ai/writer-prompt";
import { ChapterArtifactRequestSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type { ChapterMutationResponse } from "@/lib/api-contracts";
import {
  getProject,
  readChapterDocument,
  RevisionConflictError,
} from "@/lib/storage";
import { updateChapterOutlineCommand } from "@/lib/application/project-commands";

type Params = {
  params: Promise<{ id: string; chapterId: string }>;
};

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: Params) {
  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "尚未配置 AI，请在 .env.local 中设置后重启。" },
      { status: 503 },
    );
  }

  const { id, chapterId } = await params;
  try {
    const { expectedContentRevision } = await parseJson(
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
        { error: "正文为空，无法同步大纲" },
        { status: 400 },
      );
    }

    const existingOutline = chapter.outline.trim();
    const result = await generateText({
      model: getModel(project.aiModel || undefined),
      system: buildOutlineSyncPrompt(project, chapter, existingOutline),
      prompt: `【原有大纲】\n${existingOutline || "（无）"}\n\n【本章正文】\n${content}`,
      temperature: 0.3,
      abortSignal: AbortSignal.any([
        req.signal,
        AbortSignal.timeout(45_000),
      ]),
    });
    const response = await updateChapterOutlineCommand(
      id,
      chapterId,
      result.text.trim(),
      {
        expectedProjectRevision: project.revision,
        expectedContentRevision,
        expectedOutline: chapter.outline,
      },
    );
    return NextResponse.json(response satisfies ChapterMutationResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}
