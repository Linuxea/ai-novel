import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { z } from "zod";
import {
  createProject,
  deleteProject,
  updateProject,
  withProjectTransaction,
  writeProjectFiles,
  type ProjectFileInput,
} from "@/lib/storage";
import { CreateProjectSchema } from "@/lib/api-schemas";
import {
  CHAT_HISTORY_LIMIT,
  BeatSheetCacheSchema,
  ChapterSchema,
  CharacterSchema,
  ConsistencyReportSchema,
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
    status: z.enum(["drafting", "writing", "completed"]).optional(),
    ragMode: z.enum(["off", "bm25", "embed"]).optional(),
    ragTopK: z.number().int().min(1).max(20).optional(),
    generateStrategy: z.enum(["auto", "single", "multi"]).optional(),
    multiStepCritique: z.boolean().optional(),
    multiStepRewrite: z.boolean().optional(),
    autoResolveForeshadow: z.boolean().optional(),
  })
  .passthrough();

const JsonImportSchemas: Record<string, z.ZodTypeAny> = {
  "worldbuilding.json": z.array(WorldSectionSchema),
  "characters.json": z.array(CharacterSchema),
  "planning.json": z.array(PlotNoteSchema),
  "chapters.json": z.array(ChapterSchema),
  "chat.json": z
    .array(z.unknown())
    .transform((arr) => arr.slice(-CHAT_HISTORY_LIMIT)),
  "checks.json": z.record(z.string(), ConsistencyReportSchema),
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
    const createdProject = await createProject(projectInput);
    projectId = createdProject.id;
    const entries = Object.values(zip.files);
    if (entries.length > MAX_ENTRY_COUNT) {
      throw new Error("压缩包文件数量过多");
    }
    let totalSize = 0;
    const importedFiles: ProjectFileInput[] = [];
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
      importedFiles.push({
        path: name,
        content: normalizeImportContent(name, content),
      });
    }

    const project = await withProjectTransaction(createdProject.id, async () => {
      const updated = await updateProject(createdProject.id, {
        status: original.status,
        ragMode: original.ragMode,
        ragTopK: original.ragTopK,
        generateStrategy: original.generateStrategy,
        multiStepCritique: original.multiStepCritique,
        multiStepRewrite: original.multiStepRewrite,
        autoResolveForeshadow: original.autoResolveForeshadow,
      });
      await writeProjectFiles(createdProject.id, importedFiles);
      return updated;
    });

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
  return (
    name in JsonImportSchemas ||
    /^chapters\/[\w-]+\.md$/.test(name) ||
    /^chapters\/[\w-]+\.beats\.json$/.test(name)
  );
}

function normalizeImportContent(name: string, content: Buffer): Buffer | string {
  if (/^chapters\/[\w-]+\.beats\.json$/.test(name)) {
    const parsed = BeatSheetCacheSchema.parse(
      JSON.parse(content.toString("utf-8")) as unknown,
    );
    return JSON.stringify(parsed, null, 2);
  }
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
