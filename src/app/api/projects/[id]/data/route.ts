import { NextRequest, NextResponse } from "next/server";
import { getProjectData } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** 获取项目完整数据（聚合：项目元信息 + 角色 + 世界观 + 剧情 + 章节） */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const data = await getProjectData(id);
  if (!data) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json(data);
}
