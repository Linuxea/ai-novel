import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/storage";
import { CreateProjectSchema } from "@/lib/api-schemas";
import { handleRouteError, parseJson } from "@/lib/api-route";

/** 获取项目列表 */
export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** 创建项目 */
export async function POST(req: NextRequest) {
  try {
    const body = await parseJson(req, CreateProjectSchema);
    const project = await createProject(body);
    return NextResponse.json({ project }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
