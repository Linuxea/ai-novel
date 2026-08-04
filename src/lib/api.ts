import type {
  Chapter,
  Character,
  ConsistencyReport,
  PlotNote,
  Project,
  WorldSection,
} from "@/lib/types";
import type {
  ChapterMutationResponse,
  CharacterMutationResponse,
  ConsistencyCheckMutationResponse,
  CreateChapterResponse,
  DeleteCharacterResponse,
  DeleteChapterResponse,
  DeletePlotNoteResponse,
  DeleteWorldResponse,
  PlotNoteMutationResponse,
  ProjectDataResponse,
  WorldMutationResponse,
} from "@/lib/api-contracts";
import type {
  CreateChapterRequest,
  CreateCharacterRequest,
  CreatePlotNoteRequest,
  CreateProjectRequest,
  CreateWorldSectionRequest,
  LayoutPositionRequest,
  UpdateChapterRequest,
  UpdateCharacterRequest,
  UpdatePlotNoteRequest,
  UpdateProjectRequest,
  UpdateWorldSectionRequest,
  UpsertRelationshipRequest,
} from "@/lib/api-schemas";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

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
    const error = data as { error?: string; code?: string };
    throw new ApiClientError(
      error.error || `请求失败 (${res.status})`,
      res.status,
      error.code,
    );
  }
  return data as T;
}

const body = (data: unknown) => JSON.stringify(data);

/** ===== 项目 ===== */
export const api = {
  listProjects: () => req<{ projects: Project[] }>("/api/projects"),
  createProject: (input: CreateProjectRequest) =>
    req<{ project: Project }>("/api/projects", {
      method: "POST",
      body: body(input),
    }),
  getProject: (id: string) => req<{ project: Project }>(`/api/projects/${id}`),
  getProjectData: (id: string) =>
    req<ProjectDataResponse>(`/api/projects/${id}/data`),
  updateProject: (id: string, patch: UpdateProjectRequest) =>
    req<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: body(patch),
    }),
  deleteProject: (id: string) =>
    req(`/api/projects/${id}`, { method: "DELETE" }),

  /** 角色 */
  listCharacters: (id: string) =>
    req<{ characters: Character[] }>(`/api/projects/${id}/characters`),
  upsertCharacter: (id: string, data: CreateCharacterRequest) =>
    req<CharacterMutationResponse>(`/api/projects/${id}/characters`, {
      method: "POST",
      body: body(data),
    }),
  updateCharacter: (
    id: string,
    charId: string,
    patch: UpdateCharacterRequest,
  ) =>
    req<CharacterMutationResponse>(
      `/api/projects/${id}/characters/${charId}`,
      { method: "PATCH", body: body(patch) },
    ),
  deleteCharacter: (id: string, charId: string) =>
    req<DeleteCharacterResponse>(`/api/projects/${id}/characters/${charId}`, {
      method: "DELETE",
    }),
  saveCharacterLayout: (
    id: string,
    charId: string,
    position: LayoutPositionRequest,
  ) =>
    req<CharacterMutationResponse>(`/api/projects/${id}/characters/${charId}/layout`, {
      method: "PATCH",
      body: body(position),
    }),
  addRelationship: (
    id: string,
    data: UpsertRelationshipRequest,
  ) =>
    req<CharacterMutationResponse>(`/api/projects/${id}/relationships`, {
      method: "POST",
      body: body(data),
    }),

  /** 世界观 */
  listWorld: (id: string) =>
    req<{ sections: WorldSection[] }>(`/api/projects/${id}/worldbuilding`),
  upsertWorld: (id: string, data: CreateWorldSectionRequest) =>
    req<WorldMutationResponse>(`/api/projects/${id}/worldbuilding`, {
      method: "POST",
      body: body(data),
    }),
  updateWorld: (
    id: string,
    sectionId: string,
    patch: UpdateWorldSectionRequest,
  ) =>
    req<WorldMutationResponse>(
      `/api/projects/${id}/worldbuilding/${sectionId}`,
      { method: "PATCH", body: body(patch) },
    ),
  deleteWorld: (id: string, sectionId: string) =>
    req<DeleteWorldResponse>(`/api/projects/${id}/worldbuilding/${sectionId}`, {
      method: "DELETE",
    }),

  /** 剧情规划 */
  listPlanning: (id: string) =>
    req<{ notes: PlotNote[] }>(`/api/projects/${id}/planning`),
  upsertPlanning: (id: string, data: CreatePlotNoteRequest) =>
    req<PlotNoteMutationResponse>(`/api/projects/${id}/planning`, {
      method: "POST",
      body: body(data),
    }),
  updatePlanning: (
    id: string,
    noteId: string,
    patch: UpdatePlotNoteRequest,
  ) =>
    req<PlotNoteMutationResponse>(
      `/api/projects/${id}/planning/${noteId}`,
      { method: "PATCH", body: body(patch) },
    ),
  deletePlanning: (id: string, noteId: string) =>
    req<DeletePlotNoteResponse>(`/api/projects/${id}/planning/${noteId}`, {
      method: "DELETE",
    }),
  resolvePlanning: (id: string, noteId: string, chapterId: string) =>
    req<PlotNoteMutationResponse>(
      `/api/projects/${id}/planning/${noteId}/resolve`,
      { method: "POST", body: body({ chapterId }) },
    ),

  /** 章节 */
  listChapters: (id: string) =>
    req<{ chapters: Chapter[] }>(`/api/projects/${id}/chapters`),
  upsertChapter: (id: string, data: CreateChapterRequest) =>
    req<CreateChapterResponse>(`/api/projects/${id}/chapters`, {
      method: "POST",
      body: body(data),
    }),
  updateChapter: (
    id: string,
    chapterId: string,
    patch: UpdateChapterRequest,
  ) =>
    req<ChapterMutationResponse>(`/api/projects/${id}/chapters/${chapterId}`, {
      method: "PATCH",
      body: body(patch),
    }),
  deleteChapter: (id: string, chapterId: string) =>
    req<DeleteChapterResponse>(`/api/projects/${id}/chapters/${chapterId}`, {
      method: "DELETE",
    }),
  getChapterContent: (id: string, chapterId: string) =>
    req<{ content: string; contentHash: string; contentRevision: number }>(
      `/api/projects/${id}/chapters/${chapterId}/content`,
    ),
  saveChapterContent: (
    id: string,
    chapterId: string,
    content: string,
    expectedRevision: number,
  ) =>
    req<ChapterMutationResponse>(
      `/api/projects/${id}/chapters/${chapterId}/content`,
      {
        method: "PUT",
        body: body({ content, expectedRevision }),
      },
    ),
  syncOutline: (
    id: string,
    chapterId: string,
    expectedContentRevision: number,
  ) =>
    req<ChapterMutationResponse>(
      `/api/projects/${id}/chapters/${chapterId}/sync-outline`,
      {
        method: "POST",
        body: body({ expectedContentRevision }),
      },
    ),
  summarizeChapter: (
    id: string,
    chapterId: string,
    expectedContentRevision: number,
    force = false,
  ) =>
    req<{
      summary: string;
      contentHash: string;
      contentRevision: number;
      chapter: Chapter;
      cached: boolean;
    }>(
      `/api/projects/${id}/chapters/${chapterId}/summary`,
      {
        method: "POST",
        body: body({ expectedContentRevision, force }),
      },
    ),

  /** 对话历史 */
  getChat: (id: string) =>
    req<{ messages: unknown[] }>(`/api/projects/${id}/chat`),
  saveChat: (id: string, messages: unknown[]) =>
    req(`/api/projects/${id}/chat`, { method: "POST", body: body({ messages }) }),
  clearChat: (id: string) =>
    req(`/api/projects/${id}/chat`, { method: "DELETE" }),

  /** RAG 索引 */
  getRagStatus: (id: string) =>
    req<{ meta: { mode: string; builtAt: string; chunkCount: number } | null }>(
      `/api/projects/${id}/rag`,
    ),
  rebuildRagIndex: (id: string) =>
    req<{
      chunkCount: number;
      embedded?: { embedded: number; failed: number };
      embedError?: string;
    }>(`/api/projects/${id}/rag/rebuild`, { method: "POST" }),

  /** 一致性检查 */
  getCheck: (id: string, chapterId: string) =>
    req<{ report: ConsistencyReport | null; stale: boolean }>(
      `/api/projects/${id}/chapters/${chapterId}/check`,
    ),
  runCheck: (id: string, chapterId: string, expectedContentRevision: number) =>
    req<ConsistencyCheckMutationResponse>(
      `/api/projects/${id}/chapters/${chapterId}/check`,
      {
        method: "POST",
        body: body({ expectedContentRevision }),
      },
    ),
};
