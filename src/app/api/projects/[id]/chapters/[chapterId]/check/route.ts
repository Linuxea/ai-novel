import { NextRequest, NextResponse } from "next/server";
import { isAIConfigured } from "@/env";
import { getCheck } from "@/lib/storage";
import { runConsistencyCheck } from "@/lib/ai/consistency-check";
import { handleRouteError, requireProject } from "@/lib/api-route";

type Params = {
  params: Promise<{ id: string; chapterId: string }>;
};

export const runtime = "nodejs";
export const maxDuration = 120;

/** 取最近一次缓存的一致性检查报告（编辑器挂载时用，避免重跑） */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id, chapterId } = await params;
  try {
    await requireProject(id);
    const report = await getCheck(id, chapterId);
    return NextResponse.json({ report });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** 运行一致性检查（覆盖旧报告） */
export async function POST(_req: NextRequest, { params }: Params) {
  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "尚未配置 AI，无法执行一致性检查。", configured: false },
      { status: 503 },
    );
  }
  const { id, chapterId } = await params;
  try {
    await requireProject(id);
    const report = await runConsistencyCheck(id, chapterId);
    return NextResponse.json({ report });
  } catch (e) {
    return handleRouteError(e);
  }
}
