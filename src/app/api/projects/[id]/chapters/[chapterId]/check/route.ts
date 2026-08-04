import { NextRequest, NextResponse } from "next/server";
import { isAIConfigured } from "@/env";
import {
  getCheck,
  getProjectData,
  readChapterDocument,
  RevisionConflictError,
} from "@/lib/storage";
import { runConsistencyCheck } from "@/lib/ai/consistency-check";
import { ChapterArtifactRequestSchema } from "@/lib/api-schemas";
import {
  handleRouteError,
  parseJson,
  requireProject,
} from "@/lib/api-route";
import type { ConsistencyCheckMutationResponse } from "@/lib/api-contracts";

type Params = {
  params: Promise<{ id: string; chapterId: string }>;
};

export const runtime = "nodejs";
export const maxDuration = 120;

/** 取最近一次缓存的一致性检查报告（编辑器挂载时用，避免重跑） */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    const project = await requireProject(id);
    const [report, document] = await Promise.all([
      getCheck(id, chapterId),
      readChapterDocument(id, chapterId),
    ]);
    const stale = !!report && (
      report.contentRevision !== document.chapter.contentRevision ||
      report.contentHash !== document.chapter.contentHash ||
      report.committedProjectRevision !== project.revision ||
      !report.inputFingerprint
    );
    return NextResponse.json({ report, stale });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** 运行一致性检查（覆盖旧报告） */
export async function POST(req: NextRequest, { params }: Params) {
  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "尚未配置 AI，无法执行一致性检查。", configured: false },
      { status: 503 },
    );
  }
  const { id, chapterId } = await params;
  try {
    await requireProject(id);
    const { expectedContentRevision } = await parseJson(
      req,
      ChapterArtifactRequestSchema,
    );
    const document = await readChapterDocument(id, chapterId);
    if (document.chapter.contentRevision !== expectedContentRevision) {
      throw new RevisionConflictError(
        expectedContentRevision,
        document.chapter.contentRevision,
      );
    }
    const report = await runConsistencyCheck(id, chapterId, req.signal);
    const data = await getProjectData(id);
    if (!data) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    const response = {
      project: data.project,
      report,
      plotNotes: data.plotNotes,
    } satisfies ConsistencyCheckMutationResponse;
    return NextResponse.json(response);
  } catch (e) {
    return handleRouteError(e);
  }
}
