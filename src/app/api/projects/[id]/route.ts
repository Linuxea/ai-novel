import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, updateProject } from "@/lib/storage";
import { UpdateProjectSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson, requireProject } from "@/lib/api-route";

type Params = { params: Promise<{ id: string }> };

/** 获取项目元信息 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** 更新项目 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await parseJson(req, UpdateProjectSchema);
    const project = await updateProject(id, body);
    return NextResponse.json({ project });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** 删除项目 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await requireProject(id);
    await deleteProject(id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
