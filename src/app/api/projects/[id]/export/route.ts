import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getProject, projectDir } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** 导出整个项目为 zip（含所有设定与章节正文） */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const dir = projectDir(id);
  const zip = new JSZip();
  await addProjectFiles(zip, dir);

  const safeTitle = project.title.replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
  const buf = await zip.generateAsync({ type: "uint8array" });
  const encoded = encodeURIComponent(safeTitle);
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      // 同时提供 ASCII filename 与 UTF-8 filename* 以兼容中文书名
      "Content-Disposition": `attachment; filename="${project.id}.zip"; filename*=UTF-8''${encoded}.zip`,
    },
  });
}

async function addProjectFiles(zip: JSZip, dir: string): Promise<void> {
  const jsonFiles = [
    "project.json",
    "worldbuilding.json",
    "characters.json",
    "planning.json",
    "chapters.json",
    "chat.json",
    "checks.json",
  ];

  for (const file of jsonFiles) {
    const abs = path.join(/*turbopackIgnore: true*/ dir, file);
    if (await exists(abs)) zip.file(file, await fs.readFile(abs));
  }

  const chaptersDir = path.join(/*turbopackIgnore: true*/ dir, "chapters");
  if (!(await exists(chaptersDir))) return;
  const entries = await fs.readdir(chaptersDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !/^[\w-]+\.(?:md|beats\.json)$/.test(entry.name)
    ) {
      continue;
    }
    const rel = `chapters/${entry.name}`;
    zip.file(
      rel,
      await fs.readFile(
        path.join(/*turbopackIgnore: true*/ chaptersDir, entry.name),
      ),
    );
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
