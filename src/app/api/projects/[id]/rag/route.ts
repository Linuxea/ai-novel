import { NextRequest, NextResponse } from "next/server";
import { readRagMeta } from "@/lib/storage";
import { handleRouteError, requireProject } from "@/lib/api-route";

type Params = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";

/** 读取 RAG 索引状态（模式、片段数、构建时间） */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await requireProject(id);
    const meta = await readRagMeta(id);
    return NextResponse.json({ meta });
  } catch (e) {
    return handleRouteError(e);
  }
}
