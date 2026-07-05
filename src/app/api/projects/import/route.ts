import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createProject, deleteProject, projectDir, projectsDir } from "@/lib/storage";
import { CreateProjectSchema } from "@/lib/api-schemas";
import {
  ChapterSchema,
  CharacterSchema,
  PlotNoteSchema,
  WorldSectionSchema,
} from "@/lib/types";

const MAX_ZIP_SIZE = 20 * 1024 * 1024;
const MAX_ENTRY_COUNT = 1000;
const MAX_ENTRY_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

const ImportProjectSchema = z
  .object({
    title: z.string().trim().min(1),
    genre: z.string().optional(),
    summary: z.string().optional(),
    aiModel: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .passthrough();

const JsonImportSchemas: Record<string, z.ZodType<unknown>> = {
  "worldbuilding.json": z.array(WorldSectionSchema),
  "characters.json": z.array(CharacterSchema),
  "planning.json": z.array(PlotNoteSchema),
  "chapters.json": z.array(ChapterSchema),
  "chat.json": z.array(z.unknown()).max(200),
};

/** 导入项目 zip（由导出功能产生）。返回新项目 id。 */
export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传 zip 文件" }, { status: 400 });
  }
  if (file.size > MAX_ZIP_SIZE) {
    return NextResponse.json({ error: "zip 文件过大" }, { status: 400 });
  }

  let projectId: string | null = null;
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
    const original = ImportProjectSchema.parse(
      JSON.parse(await projectFile.async("string")) as unknown,
    );

    // 创建新项目（生成新 id），然后把 zip 内容写入新目录
    const projectInput = CreateProjectSchema.parse({
      title: original.title,
      genre: original.genre,
      summary: original.summary,
      aiModel: original.aiModel,
      temperature: original.temperature,
    });
    const project = await createProject(projectInput);
    projectId = project.id;

    const dir = projectDir(project.id);
    const entries = Object.values(zip.files);
    if (entries.length > MAX_ENTRY_COUNT) {
      throw new Error("压缩包文件数量过多");
    }
    let totalSize = 0;
    for (const entry of entries) {
      if (entry.dir) continue;
      const name = entry.name.replace(/\\/g, "/");
      // 跳过原 project.json（已由 createProject 生成新的，保留新 id/时间）
      if (name === "project.json") continue;
      // 跳过原子写残留的临时文件
      if (name.endsWith(".tmp")) continue;
      // 跳过已废弃的 plot.json（旧导出包可能包含）
      if (name === "plot.json") continue;
      if (!isAllowedImportPath(name)) continue;
      const content = await entry.async("nodebuffer");
      if (content.length > MAX_ENTRY_SIZE) {
        throw new Error(`文件过大：${name}`);
      }
      totalSize += content.length;
      if (totalSize > MAX_TOTAL_SIZE) {
        throw new Error("压缩包解压后体积过大");
      }
      const target = path.join(dir, name);
      // Zip Slip 防护：解析后的路径必须仍在项目目录内
      const rel = path.relative(dir, target);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, normalizeImportContent(name, content));
    }

    // 确保 projects 目录存在
    await fs.mkdir(projectsDir(), { recursive: true });

    return NextResponse.json({ project }, { status: 201 });
  } catch (e) {
    // 部分失败时回滚已创建的项目骨架
    if (projectId) {
      await deleteProject(projectId).catch(() => {});
    }
    const message = (e as Error).message;
    const status = isBadImportError(e) ? 400 : 500;
    return NextResponse.json(
      { error: `导入失败：${message}` },
      { status },
    );
  }
}

function isAllowedImportPath(name: string): boolean {
  return name in JsonImportSchemas || /^chapters\/[\w-]+\.md$/.test(name);
}

function normalizeImportContent(name: string, content: Buffer): Buffer | string {
  const schema = JsonImportSchemas[name];
  if (!schema) return content;
  const parsed = schema.parse(JSON.parse(content.toString("utf-8")) as unknown);
  return JSON.stringify(parsed, null, 2);
}

function isBadImportError(error: unknown): boolean {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return true;
  const message = (error as Error).message;
  return message.includes("压缩包") || message.includes("文件过大");
}
