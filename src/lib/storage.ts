import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "@/env";
import {
  CHAT_HISTORY_LIMIT,
  ChapterSchema,
  CharacterSchema,
  PlotNoteSchema,
  ProjectSchema,
  WorldSectionSchema,
  type Chapter,
  type Character,
  type PlotNote,
  type Project,
  type ProjectData,
  type RelationshipType,
  type WorldSection,
} from "@/lib/types";

/** ===== 路径工具 ===== */
function rootDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.DATA_DIR);
}

export function projectsDir(): string {
  return path.join(/*turbopackIgnore: true*/ rootDir(), "projects");
}

/** 校验 ID 仅含 nanoid 字符集，防止 `..`/`/` 等路径穿越。 */
function assertSafeId(id: string): void {
  if (!id || !/^[\w-]+$/.test(id)) {
    throw new Error(`非法 ID: ${JSON.stringify(id)}`);
  }
}

export function projectDir(projectId: string): string {
  assertSafeId(projectId);
  return path.join(/*turbopackIgnore: true*/ projectsDir(), projectId);
}

function chaptersDir(projectId: string): string {
  return path.join(/*turbopackIgnore: true*/ projectDir(projectId), "chapters");
}

function chapterFilePath(projectId: string, chapterId: string): string {
  assertSafeId(chapterId);
  return path.join(chaptersDir(projectId), `${chapterId}.md`);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** ===== JSON 读写（原子写） ===== */
async function readJson<T>(
  filePath: string,
  fallback: T,
  schema?: z.ZodType<T>,
): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return schema ? schema.parse(parsed) : (parsed as T);
  } catch (e) {
    if (isNodeError(e) && e.code === "ENOENT") return fallback;
    throw e;
  }
}

/** 原子写入：先写临时文件再 rename，避免并发写入产生损坏文件 */
async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${nanoid(6)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${nanoid(6)}.tmp`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

async function touchDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) await ensureDir(dir);
}

export const now = () => new Date().toISOString();

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}

/** ===== 项目级互斥锁 ===== */
/**
 * 所有写操作均为「读-改-写」，并发时会互相覆盖。
 * 这里按 projectId 串行化同一项目的写操作；
 * 借助 AsyncLocalStorage 实现可重入——外层已持锁时（如 upsert 内部
 * 再调用 create/update 的加锁版本）直接执行，不会死锁。
 */
const projectLocks = new Map<string, Promise<void>>();
const lockContext = new AsyncLocalStorage<ReadonlySet<string>>();

async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const held = lockContext.getStore();
  if (held?.has(projectId)) return fn();

  const prev = projectLocks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => current);
  projectLocks.set(projectId, tail);
  await prev;
  try {
    return await lockContext.run(new Set(held).add(projectId), fn);
  } finally {
    release();
    if (projectLocks.get(projectId) === tail) {
      projectLocks.delete(projectId);
    }
  }
}

/** ===== 项目 ===== */
export async function listProjects(): Promise<Project[]> {
  await touchDir(projectsDir());
  const entries = await fs.readdir(projectsDir(), { withFileTypes: true });
  const projects: Project[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(projectsDir(), entry.name, "project.json");
    if (!(await fileExists(metaPath))) continue;
    projects.push(await readJson<Project>(metaPath, {} as Project, ProjectSchema));
  }
  return projects.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function getProject(projectId: string): Promise<Project | null> {
  const metaPath = path.join(projectDir(projectId), "project.json");
  if (!(await fileExists(metaPath))) return null;
  return readJson<Project>(metaPath, {} as Project, ProjectSchema);
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

export async function createProject(
  input: CreateProjectInput,
): Promise<Project> {
  const id = nanoid(12);
  const dir = projectDir(id);
  await ensureDir(dir);
  await ensureDir(chaptersDir(id));
  const ts = now();
  const project: Project = {
    id,
    title: input.title.trim() || "未命名小说",
    genre: input.genre?.trim() || "其他",
    summary: input.summary?.trim() || "",
    status: "drafting",
    aiModel: input.aiModel ?? "",
    temperature: input.temperature ?? 0.8,
    createdAt: ts,
    updatedAt: ts,
  };
  await writeJson(path.join(dir, "project.json"), project);
  // 初始化各数据文件
  await writeJson(path.join(dir, "worldbuilding.json"), []);
  await writeJson(path.join(dir, "characters.json"), []);
  await writeJson(path.join(dir, "planning.json"), []);
  await writeJson(path.join(dir, "chapters.json"), []);
  await writeJson(path.join(dir, "chat.json"), []);
  return project;
}

async function updateProjectImpl(
  projectId: string,
  patch: Partial<Project>,
): Promise<Project> {
  const current = await getProject(projectId);
  if (!current) throw new NotFoundError("项目不存在");
  const updated: Project = {
    ...current,
    ...patch,
    id: current.id,
    updatedAt: now(),
  };
  await writeJson(path.join(projectDir(projectId), "project.json"), updated);
  return updated;
}

async function deleteProjectImpl(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  if (await fileExists(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
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
export async function listCharacters(projectId: string): Promise<Character[]> {
  return readList<Character>(projectId, "characters.json", CharacterSchema);
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
  return readList<WorldSection>(
    projectId,
    "worldbuilding.json",
    WorldSectionSchema,
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
}

/** ===== 剧情规划 ===== */
export async function listPlotNotes(projectId: string): Promise<PlotNote[]> {
  return readList<PlotNote>(projectId, "planning.json", PlotNoteSchema);
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
    updatedAt: now(),
  };
  list.push(created);
  await writeList(projectId, "planning.json", list);
  await touchProject(projectId);
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
  const next = list.map((p) => (p.id === existing.id ? updated : p));
  await writeList(projectId, "planning.json", next);
  await touchProject(projectId);
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
}

/** ===== 章节 ===== */
export async function listChapters(projectId: string): Promise<Chapter[]> {
  const list = await readList<Chapter>(projectId, "chapters.json", ChapterSchema);
  return list.sort((a, b) => a.order - b.order);
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
    wordCount: input.wordCount ?? 0,
    updatedAt: now(),
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
  if (await fileExists(file)) await fs.unlink(file);
  await touchProject(projectId);
}

export async function readChapterContent(
  projectId: string,
  chapterId: string,
): Promise<string> {
  const chapters = await listChapters(projectId);
  if (!chapters.some((c) => c.id === chapterId)) {
    throw new NotFoundError("章节不存在");
  }
  const file = chapterFilePath(projectId, chapterId);
  if (!(await fileExists(file))) return "";
  return fs.readFile(file, "utf-8");
}

async function writeChapterContentImpl(
  projectId: string,
  chapterId: string,
  content: string,
): Promise<void> {
  const list = await listChapters(projectId);
  if (!list.some((c) => c.id === chapterId)) {
    throw new NotFoundError("章节不存在");
  }
  const file = chapterFilePath(projectId, chapterId);
  await writeText(file, content);
  // 更新字数；仅「大纲」状态在写入正文后推进为「写作中」，已完成状态不回退
  const wordCount = content.replace(/\s+/g, "").length;
  const next = list.map((c) =>
    c.id === chapterId
      ? {
          ...c,
          wordCount,
          updatedAt: now(),
          status: c.status === "outline" ? ("drafting" as const) : c.status,
        }
      : c,
  );
  await writeList(projectId, "chapters.json", next);
  await touchProject(projectId);
}

/** ===== 对话历史 ===== */
/** 存储原始 UIMessage 对象（AI SDK v7 形状：id/role/parts），便于客户端 round-trip */
export async function readChat(projectId: string): Promise<unknown[]> {
  return readList<unknown>(projectId, "chat.json", z.unknown());
}

async function writeChatImpl(
  projectId: string,
  messages: unknown[],
): Promise<void> {
  await writeList(projectId, "chat.json", messages.slice(-CHAT_HISTORY_LIMIT));
}

/** ===== 聚合 ===== */
export async function getProjectData(
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

async function touchProject(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (project) {
    await writeJson(path.join(projectDir(projectId), "project.json"), {
      ...project,
      updatedAt: now(),
    });
  }
}

/** ===== 写操作（项目级互斥，串行执行） ===== */
export function updateProject(
  projectId: string,
  patch: Partial<Project>,
): Promise<Project> {
  return withProjectLock(projectId, () => updateProjectImpl(projectId, patch));
}

export function deleteProject(projectId: string): Promise<void> {
  return withProjectLock(projectId, () => deleteProjectImpl(projectId));
}

export function createCharacter(
  projectId: string,
  input: Partial<Character> & { name: string },
): Promise<Character> {
  return withProjectLock(projectId, () => createCharacterImpl(projectId, input));
}

export function updateCharacter(
  projectId: string,
  characterId: string,
  input: Partial<Character>,
): Promise<Character> {
  return withProjectLock(projectId, () =>
    updateCharacterImpl(projectId, characterId, input),
  );
}

export function upsertCharacter(
  projectId: string,
  input: Partial<Character> & { name: string },
): Promise<Character> {
  return withProjectLock(projectId, () => upsertCharacterImpl(projectId, input));
}

export function deleteCharacter(
  projectId: string,
  characterId: string,
): Promise<void> {
  return withProjectLock(projectId, () =>
    deleteCharacterImpl(projectId, characterId),
  );
}

export function updateCharacterLayout(
  projectId: string,
  characterId: string,
  position: { x: number; y: number },
): Promise<void> {
  return withProjectLock(projectId, () =>
    updateCharacterLayoutImpl(projectId, characterId, position),
  );
}

export function upsertRelationship(
  projectId: string,
  characterId: string,
  input: RelationshipInput,
): Promise<Character | null> {
  return withProjectLock(projectId, () =>
    upsertRelationshipImpl(projectId, characterId, input),
  );
}

export function deleteRelationship(
  projectId: string,
  characterId: string,
  relationshipId: string,
): Promise<void> {
  return withProjectLock(projectId, () =>
    deleteRelationshipImpl(projectId, characterId, relationshipId),
  );
}

export function createWorldSection(
  projectId: string,
  input: WorldSectionInput,
): Promise<WorldSection> {
  return withProjectLock(projectId, () =>
    createWorldSectionImpl(projectId, input),
  );
}

export function updateWorldSection(
  projectId: string,
  sectionId: string,
  input: Partial<WorldSection>,
): Promise<WorldSection> {
  return withProjectLock(projectId, () =>
    updateWorldSectionImpl(projectId, sectionId, input),
  );
}

export function upsertWorldSection(
  projectId: string,
  input: WorldSectionInput,
): Promise<WorldSection> {
  return withProjectLock(projectId, () =>
    upsertWorldSectionImpl(projectId, input),
  );
}

export function deleteWorldSection(
  projectId: string,
  sectionId: string,
): Promise<void> {
  return withProjectLock(projectId, () =>
    deleteWorldSectionImpl(projectId, sectionId),
  );
}

export function createPlotNote(
  projectId: string,
  input: Partial<PlotNote> & { title: string; type: PlotNote["type"] },
): Promise<PlotNote> {
  return withProjectLock(projectId, () => createPlotNoteImpl(projectId, input));
}

export function updatePlotNote(
  projectId: string,
  noteId: string,
  input: Partial<PlotNote>,
): Promise<PlotNote> {
  return withProjectLock(projectId, () =>
    updatePlotNoteImpl(projectId, noteId, input),
  );
}

export function upsertPlotNote(
  projectId: string,
  input: Partial<PlotNote> & { title: string; type: PlotNote["type"] },
): Promise<PlotNote> {
  return withProjectLock(projectId, () => upsertPlotNoteImpl(projectId, input));
}

export function deletePlotNote(
  projectId: string,
  noteId: string,
): Promise<void> {
  return withProjectLock(projectId, () => deletePlotNoteImpl(projectId, noteId));
}

export function createChapter(
  projectId: string,
  input: Partial<Chapter> & { title: string },
): Promise<Chapter> {
  return withProjectLock(projectId, () => createChapterImpl(projectId, input));
}

export function updateChapter(
  projectId: string,
  chapterId: string,
  input: Partial<Chapter>,
): Promise<Chapter> {
  return withProjectLock(projectId, () =>
    updateChapterImpl(projectId, chapterId, input),
  );
}

export function upsertChapter(
  projectId: string,
  input: Partial<Chapter> & { title: string },
): Promise<Chapter> {
  return withProjectLock(projectId, () => upsertChapterImpl(projectId, input));
}

export function deleteChapter(
  projectId: string,
  chapterId: string,
): Promise<void> {
  return withProjectLock(projectId, () =>
    deleteChapterImpl(projectId, chapterId),
  );
}

export function writeChapterContent(
  projectId: string,
  chapterId: string,
  content: string,
): Promise<void> {
  return withProjectLock(projectId, () =>
    writeChapterContentImpl(projectId, chapterId, content),
  );
}

export function writeChat(
  projectId: string,
  messages: unknown[],
): Promise<void> {
  return withProjectLock(projectId, () => writeChatImpl(projectId, messages));
}

export function clearChat(projectId: string): Promise<void> {
  return withProjectLock(projectId, () => writeChatImpl(projectId, []));
}
