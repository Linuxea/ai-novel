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
  await addDirToZip(zip, dir, "");

  const safeTitle = project.title.replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
  const buf = await zip.generateAsync({ type: "uint8array" });
  const encoded = encodeURIComponent(safeTitle);
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      // 同时提供 ASCII filename 与 UTF-8 filename* 以兼容中文书名
      "Content-Disposition": `attachment; filename="${project.id}.zip"; filename*=UTF-8''${encoded}`,
    },
  });
}

async function addDirToZip(
  zip: JSZip,
  absDir: string,
  relDir: string,
): Promise<void> {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await addDirToZip(zip, abs, rel);
    } else if (!entry.name.endsWith(".tmp")) {
      const content = await fs.readFile(abs);
      zip.file(rel, content);
    }
  }
}
