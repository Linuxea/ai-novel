import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  CHAT_HISTORY_LIMIT,
  ChapterSchema,
  CharacterSchema,
  PlotNoteSchema,
  WorldSectionSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
  type Chapter,
  type Character,
  type ConsistencyReport,
  type PlotNote,
  type Project,
  type ProjectData,
  type RelationshipType,
  type WorldSection,
  type BeatSheetCache,
} from "@/lib/types";
import {
  chunkText,
  type RagIndexRecord,
  type RagMeta,
  type RagMode,
  type RagSource,
} from "@/lib/rag/chunk";
import { buildSummaryInputFingerprint } from "@/lib/artifact-fingerprint";
import {
  deleteDirectory,
  deleteFile,
  ensureDir,
  fileExists,
  readJson,
  touchDir,
  writeFile,
  writeJson,
  writeText,
} from "@/lib/storage/file-store";
import {
  chapterFilePath,
  chaptersDir,
  projectDir,
  projectsDir,
} from "@/lib/storage/paths";
import {
  withProjectLock,
  withProjectTransaction,
} from "@/lib/storage/transaction";
import { migrateProjectDocument } from "@/lib/storage/migrations";
import {
  deleteBeatSheetCache,
  readBeatSheetCache,
  writeBeatSheetCache,
} from "@/lib/storage/repositories/beat-sheet-repository";
import {
  readChecks,
  writeChecks,
} from "@/lib/storage/repositories/checks-repository";
import {
  readRagIndexRecords,
  readRagMetadata,
  writeRagSnapshot,
} from "@/lib/storage/repositories/rag-repository";

export { projectDir, projectsDir, withProjectTransaction };

export const now = () => new Date().toISOString();

/** 正文内容指纹（sha1 前 16 位），用于摘要/检查报告的陈旧检测 */
export function hashContent(content: string): string {
  return createHash("sha1").update(content, "utf-8").digest("hex").slice(0, 16);
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class RevisionConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
    message = "数据已在其他位置更新，请刷新后重试",
  ) {
    super(message);
    this.name = "RevisionConflictError";
  }
}

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

/** ===== 项目 ===== */
export async function listProjects(): Promise<Project[]> {
  await touchDir(projectsDir());
  const entries = await fs.readdir(projectsDir(), { withFileTypes: true });
  const projects: Project[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const project = await getProject(entry.name);
    if (project) projects.push(project);
  }
  return projects.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

async function getProjectImpl(projectId: string): Promise<Project | null> {
  const metaPath = path.join(projectDir(projectId), "project.json");
  if (!(await fileExists(metaPath))) return null;
  const { project, migrated } = migrateProjectDocument(
    await readJson<unknown>(metaPath, null),
  );
  if (migrated) await writeJson(metaPath, project);
  return project;
}

export function getProject(projectId: string): Promise<Project | null> {
  return withProjectTransaction(projectId, () => getProjectImpl(projectId));
}

export async function projectExists(projectId: string): Promise<boolean> {
  const p = await getProject(projectId);
  return p !== null && !!p.id;
}

export interface CreateProjectInput {
  title: string;
  genre?: string;
  summary?: string;
  aiModel?: string;
  temperature?: number;
}

export interface ProjectFileInput {
  path: string;
  content: string | Buffer;
}

export async function createProject(
  input: CreateProjectInput,
): Promise<Project> {
  const id = nanoid(12);
  return withProjectTransaction(id, async () => {
    const dir = projectDir(id);
    await ensureDir(dir);
    await ensureDir(chaptersDir(id));
    const ts = now();
    const project: Project = {
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id,
      title: input.title.trim() || "未命名小说",
      genre: input.genre?.trim() || "其他",
      summary: input.summary?.trim() || "",
      status: "drafting",
      aiModel: input.aiModel ?? "",
      temperature: input.temperature ?? 0.8,
      ragMode: "off",
      ragTopK: 6,
      generateStrategy: "auto",
      multiStepCritique: true,
      multiStepRewrite: false,
      autoResolveForeshadow: false,
      revision: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    await writeJson(path.join(dir, "project.json"), project);
    await writeJson(path.join(dir, "worldbuilding.json"), []);
    await writeJson(path.join(dir, "characters.json"), []);
    await writeJson(path.join(dir, "planning.json"), []);
    await writeJson(path.join(dir, "chapters.json"), []);
    await writeJson(path.join(dir, "chat.json"), []);
    return project;
  });
}

export function writeProjectFiles(
  projectId: string,
  files: readonly ProjectFileInput[],
): Promise<void> {
  return withProjectTransaction(projectId, async () => {
    await requireExistingProject(projectId);
    const dir = projectDir(projectId);
    for (const file of files) {
      const target = path.resolve(dir, file.path);
      const relative = path.relative(dir, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new DomainValidationError(`非法项目文件路径: ${file.path}`);
      }
      await writeFile(target, file.content);
    }
  });
}

async function updateProjectImpl(
  projectId: string,
  patch: Partial<Project>,
): Promise<Project> {
  const current = await getProject(projectId);
  if (!current) throw new NotFoundError("项目不存在");
  const updated: Project = {
    ...current,
    ...definedFields(patch),
    id: current.id,
    schemaVersion: current.schemaVersion,
    revision: (current.revision ?? 0) + 1,
    updatedAt: now(),
  };
  await writeJson(path.join(projectDir(projectId), "project.json"), updated);
  return updated;
}

async function deleteProjectImpl(projectId: string): Promise<void> {
  await deleteDirectory(projectDir(projectId));
}

/** 过滤掉值为 undefined 的字段，用于部分更新（避免未传字段覆盖已有数据） */
function definedFields<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** ===== 通用资源读写 ===== */
async function requireExistingProject(projectId: string): Promise<Project> {
  const project = await getProject(projectId);
  if (!project) throw new NotFoundError("项目不存在");
  return project;
}

async function readList<T>(
  projectId: string,
  file: string,
  itemSchema: z.ZodType<T>,
): Promise<T[]> {
  await requireExistingProject(projectId);
  return readJson<T[]>(path.join(projectDir(projectId), file), [], z.array(itemSchema));
}

async function writeList<T>(
  projectId: string,
  file: string,
  data: T[],
): Promise<void> {
  await requireExistingProject(projectId);
  await writeJson(path.join(projectDir(projectId), file), data);
}

/** ===== 角色 ===== */
export function listCharacters(projectId: string): Promise<Character[]> {
  return withProjectLock(projectId, () =>
    readList<Character>(projectId, "characters.json", CharacterSchema),
  );
}

async function createCharacterImpl(
  projectId: string,
  input: Partial<Character> & { name: string },
): Promise<Character> {
  const list = await listCharacters(projectId);
  if (list.some((c) => c.name === input.name)) {
    throw new Error(`角色「${input.name}」已存在`);
  }

  const created: Character = {
    id: nanoid(12),
    name: input.name,
    role: input.role ?? "配角",
    aliases: input.aliases ?? [],
    appearance: input.appearance ?? "",
    personality: input.personality ?? "",
    background: input.background ?? "",
    goals: input.goals ?? "",
    abilities: input.abilities ?? "",
    notes: input.notes ?? "",
    layoutPosition: undefined,
    relationships: [],
  };
  list.push(created);
  await writeList(projectId, "characters.json", list);
  await touchProject(projectId);
  return created;
}

async function updateCharacterImpl(
  projectId: string,
  characterId: string,
  input: Partial<Character>,
): Promise<Character> {
  const list = await listCharacters(projectId);
  const existing = list.find((c) => c.id === characterId);
  if (!existing) throw new NotFoundError("角色不存在");
  if (
    input.name &&
    input.name !== existing.name &&
    list.some((c) => c.id !== characterId && c.name === input.name)
  ) {
    throw new Error(`角色「${input.name}」已存在`);
  }

  const patch = definedFields(input);
  const updated: Character = {
    ...existing,
    ...patch,
    id: existing.id,
    relationships: existing.relationships ?? [],
    layoutPosition: existing.layoutPosition ?? undefined,
  };
  const next = list.map((c) => (c.id === existing.id ? updated : c));
  await writeList(projectId, "characters.json", next);
  await touchProject(projectId);
  return updated;
}

async function upsertCharacterImpl(
  projectId: string,
  input: Partial<Character> & { name: string },
): Promise<Character> {
  const list = await listCharacters(projectId);
  const existing = input.id
    ? list.find((c) => c.id === input.id)
    : list.find((c) => c.name === input.name);

  if (existing) {
    return updateCharacterImpl(projectId, existing.id, input);
  }

  return createCharacterImpl(projectId, input);
}

async function deleteCharacterImpl(
  projectId: string,
  characterId: string,
): Promise<void> {
  const list = await listCharacters(projectId);
  const next = list.filter((c) => c.id !== characterId);
  if (next.length === list.length) throw new NotFoundError("角色不存在");
  // 同时清除指向该角色的关系
  for (const c of next) {
    if (c.relationships) {
      c.relationships = c.relationships.filter(
        (r) => r.targetId !== characterId,
      );
    }
  }
  await writeList(projectId, "characters.json", next);
  const chapters = await listChapters(projectId);
  const nextChapters = chapters.map((c) => ({
    ...c,
    characterIds: (c.characterIds ?? []).filter((id) => id !== characterId),
  }));
  await writeList(projectId, "chapters.json", nextChapters);
  const plotNotes = await listPlotNotes(projectId);
  const nextPlotNotes = plotNotes.map((p) => ({
    ...p,
    characterIds: (p.characterIds ?? []).filter((id) => id !== characterId),
  }));
  await writeList(projectId, "planning.json", nextPlotNotes);
  await touchProject(projectId);
}

async function updateCharacterLayoutImpl(
  projectId: string,
  characterId: string,
  position: { x: number; y: number },
): Promise<void> {
  const list = await listCharacters(projectId);
  if (!list.some((c) => c.id === characterId)) {
    throw new NotFoundError("角色不存在");
  }
  const next = list.map((c) =>
    c.id === characterId ? { ...c, layoutPosition: position } : c,
  );
  await writeList(projectId, "characters.json", next);
  await touchProject(projectId);
}

export interface RelationshipInput {
  targetName?: string;
  targetId?: string;
  type: RelationshipType;
  description?: string;
}

async function upsertRelationshipImpl(
  projectId: string,
  characterId: string,
  input: RelationshipInput,
): Promise<Character | null> {
  const list = await listCharacters(projectId);
  const owner = list.find((c) => c.id === characterId);
  if (!owner) return null;

  let target: Character | undefined;
  if (input.targetId) {
    target = list.find((c) => c.id === input.targetId);
    if (!target) throw new NotFoundError("目标角色不存在");
  } else if (input.targetName) {
    const targetName = input.targetName;
    const matches = list.filter(
      (c) =>
        c.name === targetName ||
        (c.aliases && c.aliases.includes(targetName)),
    );
    if (matches.length === 0) {
      throw new Error(`未找到名为「${input.targetName}」的角色`);
    }
    if (matches.length > 1) {
      const names = matches.map((c) => `${c.name}(${c.id})`).join("、");
      throw new Error(
        `「${input.targetName}」匹配到多个角色：${names}，请使用角色 id 精确指定`,
      );
    }
    target = matches[0];
  } else {
    throw new Error("缺少目标角色");
  }

  if (!target) throw new NotFoundError("目标角色不存在");
  if (target.id === characterId) return owner;

  const relationships = owner.relationships ?? [];
  const existing = relationships.find((r) => r.targetId === target.id);
  if (existing) {
    existing.type = input.type;
    existing.description = input.description ?? existing.description;
  } else {
    relationships.push({
      id: nanoid(10),
      targetId: target.id,
      type: input.type,
      description: input.description ?? "",
    });
  }
  owner.relationships = relationships;
  await writeList(projectId, "characters.json", list);
  await touchProject(projectId);
  return owner;
}

async function deleteRelationshipImpl(
  projectId: string,
  characterId: string,
  relationshipId: string,
): Promise<void> {
  const list = await listCharacters(projectId);
  const owner = list.find((c) => c.id === characterId);
  if (!owner) throw new NotFoundError("角色不存在");
  if (!(owner.relationships ?? []).some((r) => r.id === relationshipId)) {
    throw new NotFoundError("关系不存在");
  }
  const next = list.map((c) => {
    if (c.id === characterId && c.relationships) {
      return {
        ...c,
        relationships: c.relationships.filter((r) => r.id !== relationshipId),
      };
    }
    return c;
  });
  await writeList(projectId, "characters.json", next);
  await touchProject(projectId);
}

/** ===== 世界观 ===== */
export async function listWorldSections(
  projectId: string,
): Promise<WorldSection[]> {
  return withProjectLock(projectId, () =>
    readList<WorldSection>(
      projectId,
      "worldbuilding.json",
      WorldSectionSchema,
    ),
  );
}

type WorldSectionInput = Partial<WorldSection> & {
  title: string;
  category: WorldSection["category"];
} & { content?: string };

async function createWorldSectionImpl(
  projectId: string,
  input: WorldSectionInput,
): Promise<WorldSection> {
  const list = await listWorldSections(projectId);
  const created: WorldSection = {
    id: nanoid(12),
    category: input.category,
    title: input.title,
    content: input.content ?? "",
    updatedAt: now(),
  };
  list.push(created);
  await writeList(projectId, "worldbuilding.json", list);
  await touchProject(projectId);
  try {
    await upsertOwnerChunksImpl(
      projectId,
      "world",
      created.id,
      created.title,
      chunkText(`${created.title}\n${created.content}`),
    );
  } catch {
    // RAG 索引失败不影响主写
  }
  return created;
}

async function updateWorldSectionImpl(
  projectId: string,
  sectionId: string,
  input: Partial<WorldSection>,
): Promise<WorldSection> {
  const list = await listWorldSections(projectId);
  const existing = list.find((w) => w.id === sectionId);
  if (!existing) throw new NotFoundError("世界观条目不存在");

  const updated: WorldSection = {
    ...existing,
    ...definedFields(input),
    id: existing.id,
    updatedAt: now(),
  };
  const next = list.map((w) => (w.id === existing.id ? updated : w));
  await writeList(projectId, "worldbuilding.json", next);
  await touchProject(projectId);
  try {
    await upsertOwnerChunksImpl(
      projectId,
      "world",
      updated.id,
      updated.title,
      chunkText(`${updated.title}\n${updated.content}`),
    );
  } catch {
    // RAG 索引失败不影响主写
  }
  return updated;
}

async function upsertWorldSectionImpl(
  projectId: string,
  input: WorldSectionInput,
): Promise<WorldSection> {
  const list = await listWorldSections(projectId);
  const existing = input.id ? list.find((w) => w.id === input.id) : undefined;
  if (existing) {
    return updateWorldSectionImpl(projectId, existing.id, input);
  }
  return createWorldSectionImpl(projectId, input);
}

async function deleteWorldSectionImpl(
  projectId: string,
  sectionId: string,
): Promise<void> {
  const list = await listWorldSections(projectId);
  if (!list.some((w) => w.id === sectionId)) {
    throw new NotFoundError("世界观条目不存在");
  }
  await writeList(
    projectId,
    "worldbuilding.json",
    list.filter((w) => w.id !== sectionId),
  );
  await touchProject(projectId);
  try {
    await deleteOwnerChunksImpl(projectId, sectionId, "world");
  } catch {
    // RAG 索引失败不影响主写
  }
}

/** ===== 剧情规划 ===== */
export function listPlotNotes(projectId: string): Promise<PlotNote[]> {
  return withProjectLock(projectId, () =>
    readList<PlotNote>(projectId, "planning.json", PlotNoteSchema),
  );
}

async function createPlotNoteImpl(
  projectId: string,
  input: Partial<PlotNote> & { title: string; type: PlotNote["type"] },
): Promise<PlotNote> {
  const list = await listPlotNotes(projectId);
  const created: PlotNote = {
    id: nanoid(12),
    type: input.type,
    title: input.title,
    content: input.content ?? "",
    status: input.status ?? "idea",
    characterIds: input.characterIds ?? [],
    expectedPlantChapter: input.expectedPlantChapter,
    expectedResolveChapter: input.expectedResolveChapter,
    updatedAt: now(),
  };
  list.push(created);
  await writeList(projectId, "planning.json", list);
  await touchProject(projectId);
  if (created.content.trim()) {
    try {
      await upsertOwnerChunksImpl(
        projectId,
        "plot",
        created.id,
        created.title,
        [`${created.title}\n${created.content}`],
      );
    } catch {
      // RAG 索引失败不影响主写
    }
  }
  return created;
}

async function updatePlotNoteImpl(
  projectId: string,
  noteId: string,
  input: Partial<PlotNote>,
): Promise<PlotNote> {
  const list = await listPlotNotes(projectId);
  const existing = list.find((p) => p.id === noteId);
  if (!existing) throw new NotFoundError("剧情规划不存在");

  const updated: PlotNote = {
    ...existing,
    ...definedFields(input),
    id: existing.id,
    updatedAt: now(),
  };
  if (
    updated.expectedPlantChapter != null &&
    updated.expectedResolveChapter != null &&
    updated.expectedResolveChapter <= updated.expectedPlantChapter
  ) {
    throw new DomainValidationError(
      "expectedResolveChapter 必须晚于 expectedPlantChapter",
    );
  }
  const next = list.map((p) => (p.id === existing.id ? updated : p));
  await writeList(projectId, "planning.json", next);
  await touchProject(projectId);
  try {
    await upsertOwnerChunksImpl(
      projectId,
      "plot",
      updated.id,
      updated.title,
      updated.content.trim() ? [`${updated.title}\n${updated.content}`] : [],
    );
  } catch {
    // RAG 索引失败不影响主写
  }
  return updated;
}

async function upsertPlotNoteImpl(
  projectId: string,
  input: Partial<PlotNote> & { title: string; type: PlotNote["type"] },
): Promise<PlotNote> {
  const list = await listPlotNotes(projectId);
  const existing = input.id ? list.find((p) => p.id === input.id) : undefined;
  if (existing) {
    return updatePlotNoteImpl(projectId, existing.id, input);
  }
  return createPlotNoteImpl(projectId, input);
}

async function deletePlotNoteImpl(
  projectId: string,
  noteId: string,
): Promise<void> {
  const list = await listPlotNotes(projectId);
  if (!list.some((p) => p.id === noteId)) {
    throw new NotFoundError("剧情规划不存在");
  }
  await writeList(
    projectId,
    "planning.json",
    list.filter((p) => p.id !== noteId),
  );
  await touchProject(projectId);
  try {
    await deleteOwnerChunksImpl(projectId, noteId, "plot");
  } catch {
    // RAG 索引失败不影响主写
  }
}

/** ===== 章节 ===== */
export function listChapters(projectId: string): Promise<Chapter[]> {
  return withProjectLock(projectId, async () => {
    const list = await readList<Chapter>(
      projectId,
      "chapters.json",
      ChapterSchema,
    );
    return list.sort((a, b) => a.order - b.order);
  });
}

async function createChapterImpl(
  projectId: string,
  input: Partial<Chapter> & { title: string },
): Promise<Chapter> {
  const list = await listChapters(projectId);
  const maxOrder = list.reduce((m, c) => Math.max(m, c.order), 0);
  let order = input.order ?? maxOrder + 1;
  // 非法位次（非整数、越界）一律追加到末尾
  if (!Number.isInteger(order) || order < 1 || order > maxOrder + 1) {
    order = maxOrder + 1;
  }
  const created: Chapter = {
    id: nanoid(12),
    order,
    title: input.title,
    outline: input.outline ?? "",
    characterIds: input.characterIds ?? [],
    notes: input.notes ?? "",
    status: input.status ?? "outline",
    wordCount: 0,
    updatedAt: now(),
    contentHash: "",
    contentRevision: 0,
    summary: "",
    summaryOfContentHash: "",
    summaryInputFingerprint: "",
    summaryPromptVersion: 1,
  };
  // 指定位次插入时，将位次 >= order 的既有章节顺移一位，保持 order 连续无冲突
  const shifted = list.map((c) =>
    c.order >= order ? { ...c, order: c.order + 1 } : c,
  );
  shifted.push(created);
  await writeList(projectId, "chapters.json", shifted);
  await touchProject(projectId);
  return created;
}

async function updateChapterImpl(
  projectId: string,
  chapterId: string,
  input: Partial<Chapter>,
): Promise<Chapter> {
  const list = await listChapters(projectId);
  const existing = list.find((c) => c.id === chapterId);
  if (!existing) throw new NotFoundError("章节不存在");

  const updated: Chapter = {
    ...existing,
    ...definedFields(input),
    id: existing.id,
    order: existing.order,
    updatedAt: now(),
  };
  const next = list.map((c) => (c.id === existing.id ? updated : c));
  await writeList(projectId, "chapters.json", next);
  await touchProject(projectId);
  return updated;
}

async function upsertChapterImpl(
  projectId: string,
  input: Partial<Chapter> & { title: string },
): Promise<Chapter> {
  const list = await listChapters(projectId);
  const existing = input.id ? list.find((c) => c.id === input.id) : undefined;
  if (existing) {
    return updateChapterImpl(projectId, existing.id, input);
  }
  return createChapterImpl(projectId, input);
}

async function deleteChapterImpl(
  projectId: string,
  chapterId: string,
): Promise<void> {
  const list = await listChapters(projectId);
  const remaining = list.filter((c) => c.id !== chapterId);
  if (remaining.length === list.length) throw new NotFoundError("章节不存在");
  // 重排 order 为连续的 1..n，消除删除后的空洞与潜在冲突
  const reordered = remaining
    .sort((a, b) => a.order - b.order)
    .map((c, i) => ({ ...c, order: i + 1 }));
  await writeList(projectId, "chapters.json", reordered);
  const file = chapterFilePath(projectId, chapterId);
  await deleteFile(file);
  await deleteBeatSheetCache(projectId, chapterId).catch(() => {});
  await touchProject(projectId);
  try {
    await deleteOwnerChunksImpl(projectId, chapterId);
  } catch {
    // RAG 索引失败不影响主写
  }
  try {
    await deleteCheckImpl(projectId, chapterId);
  } catch {
    // 检查报告删除失败不影响主写
  }
}

async function readChapterDocumentImpl(
  projectId: string,
  chapterId: string,
): Promise<{ chapter: Chapter; content: string }> {
  const chapters = await listChapters(projectId);
  const chapter = chapters.find((c) => c.id === chapterId);
  if (!chapter) {
    throw new NotFoundError("章节不存在");
  }
  const file = chapterFilePath(projectId, chapterId);
  const content = (await fileExists(file)) ? await fs.readFile(file, "utf-8") : "";
  return { chapter, content };
}

export function readChapterDocument(
  projectId: string,
  chapterId: string,
): Promise<{ chapter: Chapter; content: string }> {
  return withProjectLock(projectId, () =>
    readChapterDocumentImpl(projectId, chapterId),
  );
}

export async function readChapterContent(
  projectId: string,
  chapterId: string,
): Promise<string> {
  return (await readChapterDocument(projectId, chapterId)).content;
}

/** 读取多步生成的 beat sheet（续写时可复用） */
export async function readBeatSheet(
  projectId: string,
  chapterId: string,
): Promise<BeatSheetCache | null> {
  return withProjectLock(projectId, () =>
    readBeatSheetCache(projectId, chapterId),
  );
}

/** 写入 beat sheet（多步生成规划步完成后落盘） */
export async function writeBeatSheet(
  projectId: string,
  chapterId: string,
  cache: BeatSheetCache,
): Promise<boolean> {
  return withProjectTransaction(projectId, async () => {
    const project = await requireExistingProject(projectId);
    const chapters = await listChapters(projectId);
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) throw new NotFoundError("章节不存在");
    if (
      project.revision !== cache.projectRevision ||
      chapter.contentRevision !== cache.contentRevision
    ) {
      return false;
    }
    await writeBeatSheetCache(projectId, chapterId, cache);
    return true;
  });
}

async function writeChapterContentImpl(
  projectId: string,
  chapterId: string,
  content: string,
  expectedRevision: number,
): Promise<Chapter> {
  const list = await listChapters(projectId);
  const existing = list.find((c) => c.id === chapterId);
  if (!existing) {
    throw new NotFoundError("章节不存在");
  }
  const contentHash = hashContent(content);
  const actualRevision = existing.contentRevision ?? 0;
  if (actualRevision !== expectedRevision) {
    if (contentHash === existing.contentHash) return existing;
    throw new RevisionConflictError(expectedRevision, actualRevision);
  }
  if (contentHash === existing.contentHash) return existing;

  const file = chapterFilePath(projectId, chapterId);
  await writeText(file, content);
  // 更新字数；仅「大纲」状态在写入正文后推进为「写作中」，已完成状态不回退
  const wordCount = content.replace(/\s+/g, "").length;
  const contentRevision = actualRevision + 1;
  const next = list.map((c) =>
    c.id === chapterId
      ? {
          ...c,
          wordCount,
          contentHash,
          contentRevision,
          updatedAt: now(),
          status: c.status === "outline" ? ("drafting" as const) : c.status,
        }
      : c,
  );
  await writeList(projectId, "chapters.json", next);
  await touchProject(projectId);
  const chapter = next.find((c) => c.id === chapterId)!;
  try {
    await upsertOwnerChunksImpl(
      projectId,
      "chapter",
      chapterId,
      `第${chapter.order}章《${chapter.title}》`,
      content.trim() ? chunkText(content) : [],
      chapter.order,
    );
  } catch {
    // RAG 索引失败不影响正文写入
  }
  return chapter;
}

/** ===== 对话历史 ===== */
/** 存储原始 UIMessage 对象（AI SDK v7 形状：id/role/parts），便于客户端 round-trip */
export function readChat(projectId: string): Promise<unknown[]> {
  return withProjectLock(projectId, () =>
    readList<unknown>(projectId, "chat.json", z.unknown()),
  );
}

async function writeChatImpl(
  projectId: string,
  messages: unknown[],
): Promise<void> {
  await writeList(projectId, "chat.json", messages.slice(-CHAT_HISTORY_LIMIT));
}

/** ===== 一致性检查报告 ===== */
export async function getCheck(
  projectId: string,
  chapterId: string,
): Promise<ConsistencyReport | null> {
  return withProjectLock(projectId, async () => {
    const map = await readChecks(projectId);
    return map[chapterId] ?? null;
  });
}

export async function saveCheck(
  projectId: string,
  chapterId: string,
  report: ConsistencyReport,
  options: {
    expectedProjectRevision: number;
    expectedContentRevision: number;
    resolvedPlotNoteIds?: string[];
    resolvedInChapter?: number;
  },
): Promise<ConsistencyReport> {
  return withProjectTransaction(projectId, async () => {
    const project = await requireExistingProject(projectId);
    if (project.revision !== options.expectedProjectRevision) {
      throw new RevisionConflictError(
        options.expectedProjectRevision,
        project.revision,
        "检查期间项目设定已变化，本次结果已丢弃",
      );
    }
    const chapters = await listChapters(projectId);
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) throw new NotFoundError("章节不存在");
    if (chapter.contentRevision !== options.expectedContentRevision) {
      throw new RevisionConflictError(
        options.expectedContentRevision,
        chapter.contentRevision,
        "检查期间正文已变化，本次结果已丢弃",
      );
    }

    const resolvedIds = new Set(options.resolvedPlotNoteIds ?? []);
    if (resolvedIds.size > 0 && options.resolvedInChapter != null) {
      const notes = await listPlotNotes(projectId);
      let changed = false;
      const next = notes.map((note) => {
        if (!resolvedIds.has(note.id) || note.status === "resolved") return note;
        changed = true;
        return {
          ...note,
          status: "resolved" as const,
          resolvedInChapter: options.resolvedInChapter,
          updatedAt: now(),
        };
      });
      if (changed) {
        await writeList(projectId, "planning.json", next);
        await touchProject(projectId);
      }
    }

    const committedProject = await requireExistingProject(projectId);
    const committedReport: ConsistencyReport = {
      ...report,
      committedProjectRevision: committedProject.revision,
    };
    const map = await readChecks(projectId);
    map[chapterId] = committedReport;
    await writeChecks(projectId, map);
    return committedReport;
  });
}

async function deleteCheckImpl(
  projectId: string,
  chapterId: string,
): Promise<void> {
  const map = await readChecks(projectId);
  if (!(chapterId in map)) return;
  delete map[chapterId];
  await writeChecks(projectId, map);
}

/** ===== 聚合 ===== */
async function getProjectDataImpl(
  projectId: string,
): Promise<ProjectData | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const [worldbuilding, characters, plotNotes, chapters] = await Promise.all([
    listWorldSections(projectId),
    listCharacters(projectId),
    listPlotNotes(projectId),
    listChapters(projectId),
  ]);
  return { project, worldbuilding, characters, plotNotes, chapters };
}

export function getProjectData(projectId: string): Promise<ProjectData | null> {
  return withProjectLock(projectId, () => getProjectDataImpl(projectId));
}

async function touchProject(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (project) {
    await writeJson(path.join(projectDir(projectId), "project.json"), {
      ...project,
      revision: (project.revision ?? 0) + 1,
      updatedAt: now(),
    });
  }
}

/** ===== RAG 索引 ===== */
export function readRagIndex(projectId: string): Promise<RagIndexRecord[]> {
  return withProjectLock(projectId, () => readRagIndexRecords(projectId));
}

export function readRagMeta(
  projectId: string,
): Promise<RagMeta | null> {
  return withProjectLock(projectId, () => readRagMetadata(projectId));
}

async function writeRagIndexImpl(
  projectId: string,
  records: RagIndexRecord[],
  mode: RagMode = "bm25",
): Promise<void> {
  await writeRagSnapshot(projectId, records, {
    mode,
    builtAt: now(),
    chunkCount: records.length,
  });
}

export async function clearRagIndex(projectId: string): Promise<void> {
  await withProjectTransaction(projectId, () =>
    writeRagIndexImpl(projectId, []),
  );
}

/** 用一组文本片段替换某 owner 在索引中的全部旧记录 */
async function upsertOwnerChunksImpl(
  projectId: string,
  source: RagSource,
  ownerId: string,
  ownerTitle: string,
  texts: string[],
  chapterOrder?: number,
): Promise<void> {
  const records = await readRagIndex(projectId);
  const kept = records.filter(
    (r) => r.chunk.source !== source || r.chunk.ownerId !== ownerId,
  );
  const ts = now();
  let idx = 0;
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    kept.push({
      chunk: {
        id: `${source}:${ownerId}:${idx}`,
        source,
        ownerId,
        ownerTitle,
        chapterOrder,
        text: trimmed,
      },
      updatedAt: ts,
    });
    idx++;
  }
  await writeRagIndexImpl(projectId, kept);
}

async function deleteOwnerChunksImpl(
  projectId: string,
  ownerId: string,
  source?: RagSource,
): Promise<void> {
  const records = await readRagIndex(projectId);
  const kept = records.filter(
    (r) =>
      r.chunk.ownerId !== ownerId ||
      (source !== undefined && r.chunk.source !== source),
  );
  if (kept.length !== records.length) {
    await writeRagIndexImpl(projectId, kept);
  }
}

/** 全量重建索引：遍历章节正文/摘要、世界观、剧情 */
async function reindexProjectImpl(projectId: string): Promise<{
  chunkCount: number;
}> {
  const ts = now();
  const records: RagIndexRecord[] = [];

  const chapters = await listChapters(projectId);
  for (const c of chapters) {
    const content = await readChapterContent(projectId, c.id);
    for (const text of chunkText(content)) {
      if (!text.trim()) continue;
      records.push({
        chunk: {
          id: `chapter:${c.id}:${records.length}`,
          source: "chapter",
          ownerId: c.id,
          ownerTitle: `第${c.order}章《${c.title}》`,
          chapterOrder: c.order,
          text,
        },
        updatedAt: ts,
      });
    }
    if (c.summary && c.summary.trim()) {
      records.push({
        chunk: {
          id: `summary:${c.id}:${records.length}`,
          source: "summary",
          ownerId: c.id,
          ownerTitle: `第${c.order}章《${c.title}》摘要`,
          chapterOrder: c.order,
          text: c.summary.trim(),
        },
        updatedAt: ts,
      });
    }
  }

  for (const w of await listWorldSections(projectId)) {
    for (const text of chunkText(`${w.title}\n${w.content}`)) {
      records.push({
        chunk: {
          id: `world:${w.id}:${records.length}`,
          source: "world",
          ownerId: w.id,
          ownerTitle: w.title,
          text,
        },
        updatedAt: ts,
      });
    }
  }

  for (const p of await listPlotNotes(projectId)) {
    if (!p.content.trim()) continue;
    records.push({
      chunk: {
        id: `plot:${p.id}:${records.length}`,
        source: "plot",
        ownerId: p.id,
        ownerTitle: p.title,
        text: `${p.title}\n${p.content}`,
      },
      updatedAt: ts,
    });
  }

  await writeRagIndexImpl(projectId, records);
  return { chunkCount: records.length };
}

/**
 * 为索引中的全部 chunk 计算并写入向量。
 * embedFn 由调用方注入（rebuild 路由传入 embedder），避免 storage 直接依赖 AI 层。
 */
export async function embedRagIndex(
  projectId: string,
  embedFn: (texts: string[]) => Promise<number[][]>,
): Promise<{ embedded: number; failed: number }> {
  const records = await withProjectLock(projectId, () =>
    readRagIndex(projectId),
  );
  if (records.length === 0) return { embedded: 0, failed: 0 };
  const sourceFingerprint = hashContent(
    JSON.stringify(
      records.map((record) => [
        record.chunk.id,
        record.updatedAt,
        record.chunk.text,
      ]),
    ),
  );
  const texts = records.map((r) => r.chunk.text);
  const embeddings = await embedFn(texts);

  return withProjectTransaction(projectId, async () => {
    const current = await readRagIndex(projectId);
    const currentFingerprint = hashContent(
      JSON.stringify(
        current.map((record) => [
          record.chunk.id,
          record.updatedAt,
          record.chunk.text,
        ]),
      ),
    );
    if (currentFingerprint !== sourceFingerprint) {
      throw new Error("向量化期间索引已变化，请重新构建");
    }
    const ts = now();
    let embedded = 0;
    let failed = 0;
    const next = records.map((r, i) => {
      const emb = embeddings[i];
      if (emb && emb.length > 0) {
        embedded++;
        return { ...r, embedding: emb, embeddedAt: ts };
      }
      failed++;
      return r;
    });
    await writeRagIndexImpl(projectId, next, "embed");
    return { embedded, failed };
  });
}

/** ===== 写操作（项目事务内串行执行） ===== */
export function updateProject(
  projectId: string,
  patch: Partial<Project>,
): Promise<Project> {
  return withProjectTransaction(projectId, () =>
    updateProjectImpl(projectId, patch),
  );
}

export function deleteProject(projectId: string): Promise<void> {
  return withProjectTransaction(projectId, () => deleteProjectImpl(projectId));
}

export function createCharacter(
  projectId: string,
  input: Partial<Character> & { name: string },
): Promise<Character> {
  return withProjectTransaction(projectId, () =>
    createCharacterImpl(projectId, input),
  );
}

export function updateCharacter(
  projectId: string,
  characterId: string,
  input: Partial<Character>,
): Promise<Character> {
  return withProjectTransaction(projectId, () =>
    updateCharacterImpl(projectId, characterId, input),
  );
}

export function upsertCharacter(
  projectId: string,
  input: Partial<Character> & { name: string },
): Promise<Character> {
  return withProjectTransaction(projectId, () =>
    upsertCharacterImpl(projectId, input),
  );
}

export function deleteCharacter(
  projectId: string,
  characterId: string,
): Promise<void> {
  return withProjectTransaction(projectId, () =>
    deleteCharacterImpl(projectId, characterId),
  );
}

export function updateCharacterLayout(
  projectId: string,
  characterId: string,
  position: { x: number; y: number },
): Promise<void> {
  return withProjectTransaction(projectId, () =>
    updateCharacterLayoutImpl(projectId, characterId, position),
  );
}

export function upsertRelationship(
  projectId: string,
  characterId: string,
  input: RelationshipInput,
): Promise<Character | null> {
  return withProjectTransaction(projectId, () =>
    upsertRelationshipImpl(projectId, characterId, input),
  );
}

export function deleteRelationship(
  projectId: string,
  characterId: string,
  relationshipId: string,
): Promise<void> {
  return withProjectTransaction(projectId, () =>
    deleteRelationshipImpl(projectId, characterId, relationshipId),
  );
}

export function createWorldSection(
  projectId: string,
  input: WorldSectionInput,
): Promise<WorldSection> {
  return withProjectTransaction(projectId, () =>
    createWorldSectionImpl(projectId, input),
  );
}

export function updateWorldSection(
  projectId: string,
  sectionId: string,
  input: Partial<WorldSection>,
): Promise<WorldSection> {
  return withProjectTransaction(projectId, () =>
    updateWorldSectionImpl(projectId, sectionId, input),
  );
}

export function upsertWorldSection(
  projectId: string,
  input: WorldSectionInput,
): Promise<WorldSection> {
  return withProjectTransaction(projectId, () =>
    upsertWorldSectionImpl(projectId, input),
  );
}

export function deleteWorldSection(
  projectId: string,
  sectionId: string,
): Promise<void> {
  return withProjectTransaction(projectId, () =>
    deleteWorldSectionImpl(projectId, sectionId),
  );
}

export function createPlotNote(
  projectId: string,
  input: Partial<PlotNote> & { title: string; type: PlotNote["type"] },
): Promise<PlotNote> {
  return withProjectTransaction(projectId, () =>
    createPlotNoteImpl(projectId, input),
  );
}

export function updatePlotNote(
  projectId: string,
  noteId: string,
  input: Partial<PlotNote>,
): Promise<PlotNote> {
  return withProjectTransaction(projectId, () =>
    updatePlotNoteImpl(projectId, noteId, input),
  );
}

export function upsertPlotNote(
  projectId: string,
  input: Partial<PlotNote> & { title: string; type: PlotNote["type"] },
): Promise<PlotNote> {
  return withProjectTransaction(projectId, () =>
    upsertPlotNoteImpl(projectId, input),
  );
}

export function deletePlotNote(
  projectId: string,
  noteId: string,
): Promise<void> {
  return withProjectTransaction(projectId, () =>
    deletePlotNoteImpl(projectId, noteId),
  );
}

export function resolvePlotNote(
  projectId: string,
  noteId: string,
  chapterId: string,
): Promise<PlotNote> {
  return withProjectTransaction(projectId, async () => {
    const chapters = await listChapters(projectId);
    const chapter = chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new NotFoundError("章节不存在");
    return updatePlotNoteImpl(projectId, noteId, {
      status: "resolved",
      resolvedInChapter: chapter.order,
    });
  });
}

export function createChapter(
  projectId: string,
  input: Partial<Chapter> & { title: string },
): Promise<Chapter> {
  return withProjectTransaction(projectId, () =>
    createChapterImpl(projectId, input),
  );
}

export function updateChapter(
  projectId: string,
  chapterId: string,
  input: Partial<Chapter>,
): Promise<Chapter> {
  return withProjectTransaction(projectId, () =>
    updateChapterImpl(projectId, chapterId, input),
  );
}

export function upsertChapter(
  projectId: string,
  input: Partial<Chapter> & { title: string },
): Promise<Chapter> {
  return withProjectTransaction(projectId, () =>
    upsertChapterImpl(projectId, input),
  );
}

export function deleteChapter(
  projectId: string,
  chapterId: string,
): Promise<void> {
  return withProjectTransaction(projectId, () =>
    deleteChapterImpl(projectId, chapterId),
  );
}

export function writeChapterContent(
  projectId: string,
  chapterId: string,
  content: string,
  expectedRevision: number,
): Promise<Chapter> {
  return withProjectTransaction(projectId, () =>
    writeChapterContentImpl(
      projectId,
      chapterId,
      content,
      expectedRevision,
    ),
  );
}

/**
 * 写入章节摘要。仅更新 summary / summaryOfContentHash / summaryGeneratedAt，
 * 不刷新 updatedAt（摘要生成不应让章节列表误显示为"刚编辑"），也不 touchProject。
 */
export async function updateChapterSummary(
  projectId: string,
  chapterId: string,
  summary: string,
  contentHash: string,
  expectedContentRevision: number,
  inputFingerprint: string,
  promptVersion: number,
): Promise<Chapter> {
  return withProjectTransaction(projectId, async () => {
    const project = await requireExistingProject(projectId);
    const list = await listChapters(projectId);
    const existing = list.find((c) => c.id === chapterId);
    if (!existing) throw new NotFoundError("章节不存在");
    if (
      existing.contentRevision !== expectedContentRevision ||
      existing.contentHash !== contentHash
    ) {
      throw new RevisionConflictError(
        expectedContentRevision,
        existing.contentRevision,
        "摘要生成期间正文已变化，本次结果已丢弃",
      );
    }
    if (
      buildSummaryInputFingerprint(project, existing, promptVersion) !==
      inputFingerprint
    ) {
      throw new RevisionConflictError(
        expectedContentRevision,
        existing.contentRevision,
        "摘要生成期间相关设定已变化，本次结果已丢弃",
      );
    }
    const updated: Chapter = {
      ...existing,
      summary,
      summaryOfContentHash: contentHash,
      summaryInputFingerprint: inputFingerprint,
      summaryPromptVersion: promptVersion,
      summaryGeneratedAt: now(),
    };
    const next = list.map((c) => (c.id === chapterId ? updated : c));
    await writeList(projectId, "chapters.json", next);
    try {
      await upsertOwnerChunksImpl(
        projectId,
        "summary",
        chapterId,
        `第${updated.order}章《${updated.title}》摘要`,
        summary.trim() ? [summary] : [],
        updated.order,
      );
    } catch {
      // RAG 索引失败不影响摘要写入
    }
    return updated;
  });
}

export function writeChat(
  projectId: string,
  messages: unknown[],
): Promise<void> {
  return withProjectTransaction(projectId, () =>
    writeChatImpl(projectId, messages),
  );
}

export function clearChat(projectId: string): Promise<void> {
  return withProjectTransaction(projectId, () => writeChatImpl(projectId, []));
}

/** 全量重建 RAG 索引（设置页"重建索引"按钮 / 首次开启 RAG 时调用） */
export function reindexProject(
  projectId: string,
): Promise<{ chunkCount: number }> {
  return withProjectTransaction(projectId, () =>
    reindexProjectImpl(projectId),
  );
}
