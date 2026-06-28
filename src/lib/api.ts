import type {
  Chapter,
  Character,
  PlotNote,
  Project,
  WorldSection,
} from "@/lib/types";

async function req<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = { ...((options?.headers as Record<string, string>) ?? {}) };
  if (options?.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 (${res.status})`);
  }
  return data as T;
}

const body = (data: unknown) => JSON.stringify(data);

/** ===== 项目 ===== */
export const api = {
  listProjects: () => req<{ projects: Project[] }>("/api/projects"),
  createProject: (input: Partial<Project>) =>
    req<{ project: Project }>("/api/projects", {
      method: "POST",
      body: body(input),
    }),
  getProject: (id: string) => req<{ project: Project }>(`/api/projects/${id}`),
  getProjectData: (id: string) =>
    req<{
      project: Project;
      worldbuilding: WorldSection[];
      characters: Character[];
      plotNotes: PlotNote[];
      chapters: Chapter[];
    }>(`/api/projects/${id}/data`),
  updateProject: (id: string, patch: Partial<Project>) =>
    req<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: body(patch),
    }),
  deleteProject: (id: string) =>
    req(`/api/projects/${id}`, { method: "DELETE" }),

  /** 角色 */
  listCharacters: (id: string) =>
    req<{ characters: Character[] }>(`/api/projects/${id}/characters`),
  upsertCharacter: (id: string, data: Partial<Character>) =>
    req<{ character: Character }>(`/api/projects/${id}/characters`, {
      method: "POST",
      body: body(data),
    }),
  updateCharacter: (id: string, charId: string, patch: Partial<Character>) =>
    req<{ character: Character }>(
      `/api/projects/${id}/characters/${charId}`,
      { method: "PATCH", body: body(patch) },
    ),
  deleteCharacter: (id: string, charId: string) =>
    req(`/api/projects/${id}/characters/${charId}`, { method: "DELETE" }),
  saveCharacterLayout: (
    id: string,
    charId: string,
    position: { x: number; y: number },
  ) =>
    req(`/api/projects/${id}/characters/${charId}/layout`, {
      method: "PATCH",
      body: body(position),
    }),
  addRelationship: (
    id: string,
    data: { characterId: string; targetName: string; type: string; description?: string },
  ) =>
    req<{ character: Character }>(`/api/projects/${id}/relationships`, {
      method: "POST",
      body: body(data),
    }),

  /** 世界观 */
  listWorld: (id: string) =>
    req<{ sections: WorldSection[] }>(`/api/projects/${id}/worldbuilding`),
  upsertWorld: (id: string, data: Partial<WorldSection>) =>
    req<{ section: WorldSection }>(`/api/projects/${id}/worldbuilding`, {
      method: "POST",
      body: body(data),
    }),
  updateWorld: (id: string, sectionId: string, patch: Partial<WorldSection>) =>
    req<{ section: WorldSection }>(
      `/api/projects/${id}/worldbuilding/${sectionId}`,
      { method: "PATCH", body: body(patch) },
    ),
  deleteWorld: (id: string, sectionId: string) =>
    req(`/api/projects/${id}/worldbuilding/${sectionId}`, {
      method: "DELETE",
    }),

  /** 剧情规划 */
  listPlanning: (id: string) =>
    req<{ notes: PlotNote[] }>(`/api/projects/${id}/planning`),
  upsertPlanning: (id: string, data: Partial<PlotNote>) =>
    req<{ note: PlotNote }>(`/api/projects/${id}/planning`, {
      method: "POST",
      body: body(data),
    }),
  updatePlanning: (id: string, noteId: string, patch: Partial<PlotNote>) =>
    req<{ note: PlotNote }>(
      `/api/projects/${id}/planning/${noteId}`,
      { method: "PATCH", body: body(patch) },
    ),
  deletePlanning: (id: string, noteId: string) =>
    req(`/api/projects/${id}/planning/${noteId}`, { method: "DELETE" }),

  /** 章节 */
  listChapters: (id: string) =>
    req<{ chapters: Chapter[] }>(`/api/projects/${id}/chapters`),
  upsertChapter: (id: string, data: Partial<Chapter>) =>
    req<{ chapter: Chapter }>(`/api/projects/${id}/chapters`, {
      method: "POST",
      body: body(data),
    }),
  updateChapter: (id: string, chapterId: string, patch: Partial<Chapter>) =>
    req<{ chapter: Chapter }>(`/api/projects/${id}/chapters/${chapterId}`, {
      method: "PATCH",
      body: body(patch),
    }),
  deleteChapter: (id: string, chapterId: string) =>
    req(`/api/projects/${id}/chapters/${chapterId}`, { method: "DELETE" }),
  getChapterContent: (id: string, chapterId: string) =>
    req<{ content: string }>(
      `/api/projects/${id}/chapters/${chapterId}/content`,
    ),
  saveChapterContent: (id: string, chapterId: string, content: string) =>
    req(`/api/projects/${id}/chapters/${chapterId}/content`, {
      method: "PUT",
      body: body({ content }),
    }),
  syncOutline: (id: string, chapterId: string) =>
    req<{ outline: string }>(
      `/api/projects/${id}/chapters/${chapterId}/sync-outline`,
      { method: "POST" },
    ),

  /** 对话历史 */
  getChat: (id: string) =>
    req<{ messages: unknown[] }>(`/api/projects/${id}/chat`),
  saveChat: (id: string, messages: unknown[]) =>
    req(`/api/projects/${id}/chat`, { method: "POST", body: body({ messages }) }),
  clearChat: (id: string) =>
    req(`/api/projects/${id}/chat`, { method: "DELETE" }),
};
