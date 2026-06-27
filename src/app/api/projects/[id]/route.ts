import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, getProjectData, updateProject } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** 获取项目元信息 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

/** 更新项目 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const project = await updateProject(id, body);
    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
}

/** 删除项目 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await deleteProject(id);
  return NextResponse.json({ success: true });
}

/** 获取项目完整数据（聚合） */
export async function PUT(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const data = await getProjectData(id);
  if (!data) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json(data);
}
