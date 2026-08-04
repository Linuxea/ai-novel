import { NextRequest, NextResponse } from "next/server";
import { embedRagIndex, reindexProject } from "@/lib/storage";
import { embedBatch, isEmbedReady } from "@/lib/ai/embedder";
import { handleRouteError, requireProject } from "@/lib/api-route";

type Params = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";
export const maxDuration = 120;

/** 全量重建 RAG 索引；若项目为 embed 模式且已配置，则同时计算向量 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const project = await requireProject(id);
    const { chunkCount } = await reindexProject(id);

    let embedded: { embedded: number; failed: number } | undefined;
    if (project.ragMode === "embed" && isEmbedReady()) {
      try {
        embedded = await embedRagIndex(id, embedBatch);
      } catch (e) {
        // 向量化失败不致命：索引已建好，embed 检索会降级为空
        return NextResponse.json({
          chunkCount,
          embedError: (e as Error).message,
        });
      }
    }

    return NextResponse.json({ chunkCount, embedded });
  } catch (e) {
    return handleRouteError(e);
  }
}
