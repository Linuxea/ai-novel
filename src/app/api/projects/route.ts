import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/storage";

/** 获取项目列表 */
export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

/** 创建项目 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const project = await createProject({
    title: body.title,
    genre: body.genre,
    summary: body.summary,
    aiModel: body.aiModel,
    temperature: body.temperature,
  });
  return NextResponse.json({ project }, { status: 201 });
}
