import { NextRequest, NextResponse } from "next/server";
import { readChapterDocument } from "@/lib/storage";
import { writeChapterContentCommand } from "@/lib/application/project-commands";
import { SaveChapterContentSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";
import type { ChapterMutationResponse } from "@/lib/api-contracts";

type Params = { params: Promise<{ id: string; chapterId: string }> };

/** 读取章节正文 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    const { content, chapter } = await readChapterDocument(id, chapterId);
    return NextResponse.json({
      content,
      contentHash: chapter.contentHash,
      contentRevision: chapter.contentRevision,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** 保存章节正文 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    const { content, expectedRevision } = await parseJson(
      req,
      SaveChapterContentSchema,
    );
    const result = await writeChapterContentCommand(
      id,
      chapterId,
      content,
      expectedRevision,
    );
    const response = result satisfies ChapterMutationResponse;
    return NextResponse.json(response);
  } catch (e) {
    return handleRouteError(e);
  }
}
