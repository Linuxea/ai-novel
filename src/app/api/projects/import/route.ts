import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createProject, projectDir, projectsDir } from "@/lib/storage";

/** 导入项目 zip（由导出功能产生）。返回新项目 id。 */
export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传 zip 文件" }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);

    // 读取原 project.json
    const projectFile = zip.file("project.json");
    if (!projectFile) {
      return NextResponse.json(
        { error: "无效的项目压缩包（缺少 project.json）" },
        { status: 400 },
      );
    }
    const original = JSON.parse(
      await projectFile.async("string"),
    ) as { title: string; genre?: string; summary?: string; aiModel?: string; temperature?: number };

    // 创建新项目（生成新 id），然后把 zip 内容写入新目录
    const project = await createProject({
      title: original.title,
      genre: original.genre,
      summary: original.summary,
      aiModel: original.aiModel,
      temperature: original.temperature,
    });

    const dir = projectDir(project.id);
    const entries = Object.values(zip.files);
    for (const entry of entries) {
      if (entry.dir) continue;
      // 跳过原 project.json（已由 createProject 生成新的，保留新 id/时间）
      if (entry.name === "project.json") continue;
      const content = await entry.async("nodebuffer");
      const target = path.join(dir, entry.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }

    // 确保 projects 目录存在
    await fs.mkdir(projectsDir(), { recursive: true });

    return NextResponse.json({ project }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: `导入失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
