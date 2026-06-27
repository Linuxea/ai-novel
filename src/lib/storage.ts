import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { env } from "@/env";
import type {
  Chapter,
  Character,
  PlotPoint,
  Project,
  ProjectData,
  RelationshipType,
  WorldSection,
} from "@/lib/types";

/** ===== 路径工具 ===== */
function rootDir(): string {
  return path.resolve(process.cwd(), env.DATA_DIR);
}

export function projectsDir(): string {
  return path.join(rootDir(), "projects");
}

/** 校验 ID 仅含 nanoid 字符集，防止 `..`/`/` 等路径穿越。 */
function assertSafeId(id: string): void {
  if (!id || !/^[\w-]+$/.test(id)) {
    throw new Error(`非法 ID: ${JSON.stringify(id)}`);
  }
}

export function projectDir(projectId: string): string {
  assertSafeId(projectId);
  return path.join(projectsDir(), projectId);
}

function chaptersDir(projectId: string): string {
  return path.join(projectDir(projectId), "chapters");
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
async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 原子写入：先写临时文件再 rename，避免并发写入产生损坏文件 */
async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

async function touchDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) await ensureDir(dir);
}

export const now = () => new Date().toISOString();

/** ===== 项目 ===== */
export async function listProjects(): Promise<Project[]> {
  await touchDir(projectsDir());
  const entries = await fs.readdir(projectsDir(), { withFileTypes: true });
  const projects: Project[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(projectsDir(), entry.name, "project.json");
    if (!(await fileExists(metaPath))) continue;
    projects.push(await readJson<Project>(metaPath, {} as Project));
  }
  return projects.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function getProject(projectId: string): Promise<Project | null> {
  const metaPath = path.join(projectDir(projectId), "project.json");
  if (!(await fileExists(metaPath))) return null;
  return readJson<Project>(metaPath, {} as Project);
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
  await writeJson(path.join(dir, "plot.json"), []);
  await writeJson(path.join(dir, "chapters.json"), []);
  await writeJson(path.join(dir, "chat.json"), []);
  return project;
}

export async function updateProject(
  projectId: string,
  patch: Partial<Project>,
): Promise<Project> {
  const current = await getProject(projectId);
  if (!current) throw new Error(`项目不存在: ${projectId}`);
  const updated: Project = {
    ...current,
    ...patch,
    id: current.id,
    updatedAt: now(),
  };
  await writeJson(path.join(projectDir(projectId), "project.json"), updated);
  return updated;
}

export async function deleteProject(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  if (await fileExists(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** ===== 通用资源读写 ===== */
async function readList<T>(projectId: string, file: string): Promise<T[]> {
  return readJson<T[]>(path.join(projectDir(projectId), file), []);
}

async function writeList<T>(
  projectId: string,
  file: string,
  data: T[],
): Promise<void> {
  await writeJson(path.join(projectDir(projectId), file), data);
}

/** ===== 角色 ===== */
export async function listCharacters(projectId: string): Promise<Character[]> {
  return readList<Character>(projectId, "characters.json");
}

export async function upsertCharacter(
  projectId: string,
  input: Partial<Character> & { name: string },
): Promise<Character> {
  const list = await listCharacters(projectId);
  const existing = input.id
    ? list.find((c) => c.id === input.id)
    : list.find((c) => c.name === input.name);

  if (existing) {
    // 仅覆盖 input 中已定义的字段，避免未传字段（undefined）清空已有数据
    const patch = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    );
    const updated: Character = {
      ...existing,
      ...patch,
      id: existing.id,
      name: input.name ?? existing.name,
      relationships: existing.relationships ?? [],
      layoutPosition: existing.layoutPosition ?? undefined,
    };
    const next = list.map((c) => (c.id === existing.id ? updated : c));
    await writeList(projectId, "characters.json", next);
    await touchProject(projectId);
    return updated;
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

export async function deleteCharacter(
  projectId: string,
  characterId: string,
): Promise<void> {
  const list = await listCharacters(projectId);
  const next = list.filter((c) => c.id !== characterId);
  // 同时清除指向该角色的关系
  for (const c of next) {
    if (c.relationships) {
      c.relationships = c.relationships.filter(
        (r) => r.targetId !== characterId,
      );
    }
  }
  await writeList(projectId, "characters.json", next);
  await touchProject(projectId);
}

export async function updateCharacterLayout(
  projectId: string,
  characterId: string,
  position: { x: number; y: number },
): Promise<void> {
  const list = await listCharacters(projectId);
  const next = list.map((c) =>
    c.id === characterId ? { ...c, layoutPosition: position } : c,
  );
  await writeList(projectId, "characters.json", next);
}

export interface RelationshipInput {
  targetName: string;
  type: RelationshipType;
  description?: string;
}

export async function upsertRelationship(
  projectId: string,
  characterId: string,
  input: RelationshipInput,
): Promise<Character | null> {
  const list = await listCharacters(projectId);
  const owner = list.find((c) => c.id === characterId);
  if (!owner) return null;
  const target = list.find(
    (c) =>
      c.name === input.targetName ||
      (c.aliases && c.aliases.includes(input.targetName)),
  );
  if (!target) {
    throw new Error(`未找到名为「${input.targetName}」的角色`);
  }
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

export async function deleteRelationship(
  projectId: string,
  characterId: string,
  relationshipId: string,
): Promise<void> {
  const list = await listCharacters(projectId);
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
}

/** ===== 世界观 ===== */
export async function listWorldSections(
  projectId: string,
): Promise<WorldSection[]> {
  return readList<WorldSection>(projectId, "worldbuilding.json");
}

export async function upsertWorldSection(
  projectId: string,
  input: Partial<WorldSection> & { title: string; category: WorldSection["category"] } & {
    content?: string;
  },
): Promise<WorldSection> {
  const list = await listWorldSections(projectId);
  const existing = input.id ? list.find((w) => w.id === input.id) : undefined;
  if (existing) {
    const updated: WorldSection = {
      ...existing,
      ...input,
      id: existing.id,
      updatedAt: now(),
    };
    const next = list.map((w) => (w.id === existing.id ? updated : w));
    await writeList(projectId, "worldbuilding.json", next);
    await touchProject(projectId);
    return updated;
  }
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

export async function deleteWorldSection(
  projectId: string,
  sectionId: string,
): Promise<void> {
  const list = await listWorldSections(projectId);
  await writeList(
    projectId,
    "worldbuilding.json",
    list.filter((w) => w.id !== sectionId),
  );
  await touchProject(projectId);
}

/** ===== 剧情 ===== */
export async function listPlotPoints(
  projectId: string,
): Promise<PlotPoint[]> {
  return readList<PlotPoint>(projectId, "plot.json");
}

export async function upsertPlotPoint(
  projectId: string,
  input: Partial<PlotPoint> & { title: string },
): Promise<PlotPoint> {
  const list = await listPlotPoints(projectId);
  const existing = input.id ? list.find((p) => p.id === input.id) : undefined;
  if (existing) {
    const updated: PlotPoint = { ...existing, ...input, id: existing.id };
    const next = list.map((p) => (p.id === existing.id ? updated : p));
    await writeList(projectId, "plot.json", next);
    await touchProject(projectId);
    return updated;
  }
  const created: PlotPoint = {
    id: nanoid(12),
    act: input.act ?? 1,
    order: input.order ?? list.length + 1,
    title: input.title,
    summary: input.summary ?? "",
    characterIds: input.characterIds ?? [],
  };
  list.push(created);
  await writeList(projectId, "plot.json", list);
  await touchProject(projectId);
  return created;
}

export async function deletePlotPoint(
  projectId: string,
  plotId: string,
): Promise<void> {
  const list = await listPlotPoints(projectId);
  await writeList(
    projectId,
    "plot.json",
    list.filter((p) => p.id !== plotId),
  );
  await touchProject(projectId);
}

/** ===== 章节 ===== */
export async function listChapters(projectId: string): Promise<Chapter[]> {
  const list = await readList<Chapter>(projectId, "chapters.json");
  return list.sort((a, b) => a.order - b.order);
}

export async function upsertChapter(
  projectId: string,
  input: Partial<Chapter> & { title: string },
): Promise<Chapter> {
  const list = await listChapters(projectId);
  const existing = input.id ? list.find((c) => c.id === input.id) : undefined;
  if (existing) {
    const updated: Chapter = {
      ...existing,
      ...input,
      id: existing.id,
      updatedAt: now(),
    };
    const next = list.map((c) => (c.id === existing.id ? updated : c));
    await writeList(projectId, "chapters.json", next);
    await touchProject(projectId);
    return updated;
  }
  const created: Chapter = {
    id: nanoid(12),
    order: input.order ?? list.length + 1,
    title: input.title,
    outline: input.outline ?? "",
    status: input.status ?? "outline",
    wordCount: input.wordCount ?? 0,
    updatedAt: now(),
  };
  list.push(created);
  await writeList(projectId, "chapters.json", list);
  await touchProject(projectId);
  return created;
}

export async function deleteChapter(
  projectId: string,
  chapterId: string,
): Promise<void> {
  const list = await listChapters(projectId);
  await writeList(
    projectId,
    "chapters.json",
    list.filter((c) => c.id !== chapterId),
  );
  const file = chapterFilePath(projectId, chapterId);
  if (await fileExists(file)) await fs.unlink(file);
  await touchProject(projectId);
}

export async function readChapterContent(
  projectId: string,
  chapterId: string,
): Promise<string> {
  const file = chapterFilePath(projectId, chapterId);
  if (!(await fileExists(file))) return "";
  return fs.readFile(file, "utf-8");
}

export async function writeChapterContent(
  projectId: string,
  chapterId: string,
  content: string,
): Promise<void> {
  await ensureDir(chaptersDir(projectId));
  const file = chapterFilePath(projectId, chapterId);
  await fs.writeFile(file, content, "utf-8");
  // 更新字数
  const list = await listChapters(projectId);
  const wordCount = content.replace(/\s+/g, "").length;
  const next = list.map((c) =>
    c.id === chapterId
      ? { ...c, wordCount, updatedAt: now(), status: "drafting" as const }
      : c,
  );
  await writeList(projectId, "chapters.json", next);
  await touchProject(projectId);
}

/** ===== 对话历史 ===== */
/** 存储原始 UIMessage 对象（AI SDK v7 形状：id/role/parts），便于客户端 round-trip */
export async function readChat(projectId: string): Promise<unknown[]> {
  return readList<unknown>(projectId, "chat.json");
}

export async function writeChat(
  projectId: string,
  messages: unknown[],
): Promise<void> {
  await writeList(projectId, "chat.json", messages);
}

export async function clearChat(projectId: string): Promise<void> {
  await writeChat(projectId, []);
}

/** ===== 聚合 ===== */
export async function getProjectData(
  projectId: string,
): Promise<ProjectData | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const [worldbuilding, characters, plot, chapters] = await Promise.all([
    listWorldSections(projectId),
    listCharacters(projectId),
    listPlotPoints(projectId),
    listChapters(projectId),
  ]);
  return { project, worldbuilding, characters, plot, chapters };
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
