"use client";

import { create } from "zustand";
import { api } from "@/lib/api";
import type {
  Chapter,
  Character,
  PlotNote,
  Project,
  WorldSection,
} from "@/lib/types";

interface ProjectState {
  projectId: string | null;
  project: Project | null;
  characters: Character[];
  worldbuilding: WorldSection[];
  plotNotes: PlotNote[];
  chapters: Chapter[];
  loading: boolean;
  error: string | null;

  load: (projectId: string) => Promise<void>;
  reload: () => Promise<void>;
  reset: () => void;

  /** 局部更新（乐观刷新） */
  upsertCharacterLocal: (c: Character) => void;
  removeCharacterLocal: (id: string) => void;
  upsertWorldLocal: (w: WorldSection) => void;
  removeWorldLocal: (id: string) => void;
  upsertPlotNoteLocal: (p: PlotNote) => void;
  removePlotNoteLocal: (id: string) => void;
  upsertChapterLocal: (c: Chapter) => void;
  removeChapterLocal: (id: string) => void;
}

let loadSeq = 0;

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectId: null,
  project: null,
  characters: [],
  worldbuilding: [],
  plotNotes: [],
  chapters: [],
  loading: false,
  error: null,

  load: async (projectId) => {
    const seq = ++loadSeq;
    const current = get();
    const sameProject = current.project?.id === projectId;
    set(
      sameProject
        ? { projectId, loading: true, error: null }
        : {
            projectId,
            project: null,
            characters: [],
            worldbuilding: [],
            plotNotes: [],
            chapters: [],
            loading: true,
            error: null,
          },
    );
    try {
      const data = await api.getProjectData(projectId);
      if (seq !== loadSeq || get().projectId !== projectId) return;
      set({
        project: data.project,
        characters: data.characters,
        worldbuilding: data.worldbuilding,
        plotNotes: data.plotNotes,
        chapters: data.chapters,
        loading: false,
        error: null,
      });
    } catch (e) {
      if (seq !== loadSeq || get().projectId !== projectId) return;
      set({ loading: false, error: (e as Error).message });
    }
  },

  reload: async () => {
    const id = get().projectId;
    if (id) await get().load(id);
  },

  reset: () => {
    loadSeq++;
    set({
      projectId: null,
      project: null,
      characters: [],
      worldbuilding: [],
      plotNotes: [],
      chapters: [],
      error: null,
      loading: false,
    });
  },

  upsertCharacterLocal: (c) =>
    set((s) => {
      const exists = s.characters.some((x) => x.id === c.id);
      return {
        characters: exists
          ? s.characters.map((x) => (x.id === c.id ? c : x))
          : [...s.characters, c],
      };
    }),

  removeCharacterLocal: (id) =>
    set((s) => ({
      characters: s.characters
        .filter((x) => x.id !== id)
        .map((x) => ({
          ...x,
          relationships: x.relationships?.filter((r) => r.targetId !== id),
        })),
      // 与服务端 deleteCharacter 的级联清理保持一致
      chapters: s.chapters.map((c) => ({
        ...c,
        characterIds: (c.characterIds ?? []).filter((cid) => cid !== id),
      })),
      plotNotes: s.plotNotes.map((p) => ({
        ...p,
        characterIds: (p.characterIds ?? []).filter((cid) => cid !== id),
      })),
    })),

  upsertWorldLocal: (w) =>
    set((s) => {
      const exists = s.worldbuilding.some((x) => x.id === w.id);
      return {
        worldbuilding: exists
          ? s.worldbuilding.map((x) => (x.id === w.id ? w : x))
          : [...s.worldbuilding, w],
      };
    }),

  removeWorldLocal: (id) =>
    set((s) => ({ worldbuilding: s.worldbuilding.filter((x) => x.id !== id) })),

  upsertPlotNoteLocal: (p) =>
    set((s) => {
      const exists = s.plotNotes.some((x) => x.id === p.id);
      return {
        plotNotes: exists
          ? s.plotNotes.map((x) => (x.id === p.id ? p : x))
          : [...s.plotNotes, p],
      };
    }),

  removePlotNoteLocal: (id) =>
    set((s) => ({ plotNotes: s.plotNotes.filter((x) => x.id !== id) })),

  upsertChapterLocal: (c) =>
    set((s) => {
      const exists = s.chapters.some((x) => x.id === c.id);
      return {
        chapters: exists
          ? s.chapters.map((x) => (x.id === c.id ? c : x))
          : [...s.chapters, c],
      };
    }),

  removeChapterLocal: (id) =>
    set((s) => ({ chapters: s.chapters.filter((x) => x.id !== id) })),
}));
