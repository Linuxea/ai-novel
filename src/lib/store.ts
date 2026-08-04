"use client";

import {
  createContext,
  createElement,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { api } from "@/lib/api";
import type {
  Chapter,
  Character,
  PlotNote,
  Project,
  ProjectData,
  WorldSection,
} from "@/lib/types";

export interface ProjectState {
  projectId: string;
  project: Project;
  characters: Character[];
  worldbuilding: WorldSection[];
  plotNotes: PlotNote[];
  chapters: Chapter[];
  loading: boolean;
  error: string | null;

  reload: () => Promise<void>;
  setProjectLocal: (project: Project) => void;
  commitChapterLocal: (project: Project, chapter: Chapter) => void;
  replaceChaptersLocal: (project: Project, chapters: Chapter[]) => void;
  commitCharacterLocal: (project: Project, character: Character) => void;
  replaceCharacterDataLocal: (
    project: Project,
    characters: Character[],
    chapters: Chapter[],
    plotNotes: PlotNote[],
  ) => void;
  commitWorldLocal: (project: Project, section: WorldSection) => void;
  replaceWorldbuildingLocal: (
    project: Project,
    worldbuilding: WorldSection[],
  ) => void;
  commitPlotNoteLocal: (project: Project, note: PlotNote) => void;
  replacePlotNotesLocal: (project: Project, plotNotes: PlotNote[]) => void;
  upsertChapterLocal: (chapter: Chapter) => void;
}

export type ProjectStoreApi = StoreApi<ProjectState>;
type ProjectDataLoader = (projectId: string) => Promise<ProjectData>;

export function createProjectStore(
  initialData: ProjectData,
  loadProjectData: ProjectDataLoader = api.getProjectData,
): ProjectStoreApi {
  const projectId = initialData.project.id;
  let loadSeq = 0;
  let localCommitSeq = 0;

  return createStore<ProjectState>((set, get) => {
    const commit = (
      update:
        | Partial<ProjectState>
        | ((state: ProjectState) => Partial<ProjectState>),
    ) => {
      localCommitSeq++;
      set(update);
    };

    const reloadWithRetry = async (retry = 0): Promise<void> => {
      const seq = ++loadSeq;
      const commitSeqAtStart = localCommitSeq;
      set({ loading: true, error: null });
      try {
        const data = await loadProjectData(projectId);
        if (seq !== loadSeq || data.project.id !== projectId) return;

        const currentRevision = get().project.revision;
        if (
          commitSeqAtStart !== localCommitSeq ||
          data.project.revision < currentRevision
        ) {
          if (retry < 2) {
            await reloadWithRetry(retry + 1);
          } else if (seq === loadSeq) {
            set({ loading: false });
          }
          return;
        }

        set({
          project: data.project,
          characters: data.characters,
          worldbuilding: data.worldbuilding,
          plotNotes: data.plotNotes,
          chapters: data.chapters,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (seq !== loadSeq) return;
        set({ loading: false, error: (error as Error).message });
      }
    };

    return {
      projectId,
      project: initialData.project,
      characters: initialData.characters,
      worldbuilding: initialData.worldbuilding,
      plotNotes: initialData.plotNotes,
      chapters: initialData.chapters,
      loading: false,
      error: null,

      reload: () => reloadWithRetry(),
      setProjectLocal: (project) => {
        if (
          project.id !== projectId ||
          project.revision < get().project.revision
        ) {
          return;
        }
        const currentRevision = get().project.revision;
        commit({ project });
        if (project.revision > currentRevision + 1) {
          void reloadWithRetry();
        }
      },
      commitChapterLocal: (project, chapter) => {
        if (
          project.id !== projectId ||
          project.revision < get().project.revision
        ) {
          return;
        }
        const currentRevision = get().project.revision;
        commit((state) => {
          const exists = state.chapters.some((item) => item.id === chapter.id);
          return {
            project,
            chapters: exists
              ? state.chapters.map((item) =>
                  item.id === chapter.id ? chapter : item,
                )
              : [...state.chapters, chapter],
          };
        });
        if (project.revision > currentRevision + 1) {
          void reloadWithRetry();
        }
      },
      replaceChaptersLocal: (project, chapters) => {
        if (
          project.id !== projectId ||
          project.revision < get().project.revision
        ) {
          return;
        }
        const currentRevision = get().project.revision;
        commit({ project, chapters });
        if (project.revision > currentRevision + 1) {
          void reloadWithRetry();
        }
      },
      commitCharacterLocal: (project, character) => {
        if (
          project.id !== projectId ||
          project.revision < get().project.revision
        ) {
          return;
        }
        const currentRevision = get().project.revision;
        commit((state) => {
          const exists = state.characters.some(
            (item) => item.id === character.id,
          );
          return {
            project,
            characters: exists
              ? state.characters.map((item) =>
                  item.id === character.id ? character : item,
                )
              : [...state.characters, character],
          };
        });
        if (project.revision > currentRevision + 1) {
          void reloadWithRetry();
        }
      },
      replaceCharacterDataLocal: (
        project,
        characters,
        chapters,
        plotNotes,
      ) => {
        if (
          project.id !== projectId ||
          project.revision < get().project.revision
        ) {
          return;
        }
        const currentRevision = get().project.revision;
        commit({ project, characters, chapters, plotNotes });
        if (project.revision > currentRevision + 1) {
          void reloadWithRetry();
        }
      },
      commitWorldLocal: (project, section) => {
        if (
          project.id !== projectId ||
          project.revision < get().project.revision
        ) {
          return;
        }
        const currentRevision = get().project.revision;
        commit((state) => {
          const exists = state.worldbuilding.some(
            (item) => item.id === section.id,
          );
          return {
            project,
            worldbuilding: exists
              ? state.worldbuilding.map((item) =>
                  item.id === section.id ? section : item,
                )
              : [...state.worldbuilding, section],
          };
        });
        if (project.revision > currentRevision + 1) {
          void reloadWithRetry();
        }
      },
      replaceWorldbuildingLocal: (project, worldbuilding) => {
        if (
          project.id !== projectId ||
          project.revision < get().project.revision
        ) {
          return;
        }
        const currentRevision = get().project.revision;
        commit({ project, worldbuilding });
        if (project.revision > currentRevision + 1) {
          void reloadWithRetry();
        }
      },
      commitPlotNoteLocal: (project, note) => {
        if (
          project.id !== projectId ||
          project.revision < get().project.revision
        ) {
          return;
        }
        const currentRevision = get().project.revision;
        commit((state) => {
          const exists = state.plotNotes.some((item) => item.id === note.id);
          return {
            project,
            plotNotes: exists
              ? state.plotNotes.map((item) =>
                  item.id === note.id ? note : item,
                )
              : [...state.plotNotes, note],
          };
        });
        if (project.revision > currentRevision + 1) {
          void reloadWithRetry();
        }
      },
      replacePlotNotesLocal: (project, plotNotes) => {
        if (
          project.id !== projectId ||
          project.revision < get().project.revision
        ) {
          return;
        }
        const currentRevision = get().project.revision;
        commit({ project, plotNotes });
        if (project.revision > currentRevision + 1) {
          void reloadWithRetry();
        }
      },
      upsertChapterLocal: (chapter) =>
        commit((state) => {
          const exists = state.chapters.some((item) => item.id === chapter.id);
          return {
            chapters: exists
              ? state.chapters.map((item) =>
                  item.id === chapter.id ? chapter : item,
                )
              : [...state.chapters, chapter],
          };
        }),
    };
  });
}

const ProjectStoreContext = createContext<ProjectStoreApi | null>(null);

export function ProjectStoreProvider({
  initialData,
  children,
}: {
  initialData: ProjectData;
  children: ReactNode;
}) {
  const [store] = useState(() => createProjectStore(initialData));
  return createElement(
    ProjectStoreContext.Provider,
    { value: store },
    children,
  );
}

export function useProjectStore<T>(
  selector: (state: ProjectState) => T,
): T {
  const store = useProjectStoreApi();
  return useStore(store, selector);
}

export function useProjectStoreApi(): ProjectStoreApi {
  const store = useContext(ProjectStoreContext);
  if (!store) {
    throw new Error("useProjectStore 必须在 ProjectStoreProvider 内使用");
  }
  return store;
}
