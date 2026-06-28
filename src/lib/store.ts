"use client";

import { create } from "zustand";
import { api } from "@/lib/api";
import type {
  Chapter,
  Character,
  PlotPoint,
  Project,
  WorldSection,
} from "@/lib/types";

interface ProjectState {
  projectId: string | null;
  project: Project | null;
  characters: Character[];
  worldbuilding: WorldSection[];
  plot: PlotPoint[];
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
  upsertPlotLocal: (p: PlotPoint) => void;
  removePlotLocal: (id: string) => void;
  upsertChapterLocal: (c: Chapter) => void;
  removeChapterLocal: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectId: null,
  project: null,
  characters: [],
  worldbuilding: [],
  plot: [],
  chapters: [],
  loading: false,
  error: null,

  load: async (projectId) => {
    set({ projectId, loading: true, error: null });
    try {
      const data = await api.getProjectData(projectId);
      set({
        project: data.project,
        characters: data.characters,
        worldbuilding: data.worldbuilding,
        plot: data.plot,
        chapters: data.chapters,
        loading: false,
        error: null,
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  reload: async () => {
    const id = get().projectId;
    if (id) await get().load(id);
  },

  reset: () =>
    set({
      projectId: null,
      project: null,
      characters: [],
      worldbuilding: [],
      plot: [],
      chapters: [],
      error: null,
    }),

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

  upsertPlotLocal: (p) =>
    set((s) => {
      const exists = s.plot.some((x) => x.id === p.id);
      return {
        plot: exists ? s.plot.map((x) => (x.id === p.id ? p : x)) : [...s.plot, p],
      };
    }),

  removePlotLocal: (id) =>
    set((s) => ({ plot: s.plot.filter((x) => x.id !== id) })),

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
