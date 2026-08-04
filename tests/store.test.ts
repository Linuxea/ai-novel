import { describe, expect, it } from "vitest";
import { createProjectStore } from "@/lib/store";
import {
  ChapterSchema,
  PlotNoteSchema,
  ProjectSchema,
  WorldSectionSchema,
  type ProjectData,
} from "@/lib/types";

function projectData(id: string, revision = 1): ProjectData {
  return {
    project: ProjectSchema.parse({
      id,
      title: `项目 ${id}`,
      genre: "悬疑",
      summary: "",
      status: "drafting",
      revision,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    characters: [],
    worldbuilding: [],
    plotNotes: [],
    chapters: [],
  };
}

function chapter(id: string, order: number) {
  return ChapterSchema.parse({
    id,
    order,
    title: `章节 ${id}`,
    status: "outline",
  });
}

describe("project-scoped store", () => {
  it("isolates local mutations between project instances", () => {
    const storeA = createProjectStore(projectData("a"));
    const storeB = createProjectStore(projectData("b"));

    storeA.getState().upsertChapterLocal(chapter("a-1", 1));

    expect(storeA.getState().chapters.map((item) => item.id)).toEqual(["a-1"]);
    expect(storeB.getState().chapters).toEqual([]);
  });

  it("retries a reload when a local commit lands during the request", async () => {
    let releaseFirst!: (data: ProjectData) => void;
    let calls = 0;
    const refreshed = projectData("a", 2);
    refreshed.chapters = [chapter("server", 1), chapter("local", 2)];
    const loader = async () => {
      calls++;
      if (calls === 1) {
        return new Promise<ProjectData>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return refreshed;
    };
    const store = createProjectStore(projectData("a"), loader);

    const reload = store.getState().reload();
    store.getState().upsertChapterLocal(chapter("local", 1));
    releaseFirst(projectData("a", 1));
    await reload;

    expect(calls).toBe(2);
    expect(store.getState().project.revision).toBe(2);
    expect(store.getState().chapters.map((item) => item.id)).toEqual([
      "server",
      "local",
    ]);
  });

  it("atomically applies canonical chapter collections", () => {
    const initial = projectData("a", 1);
    initial.chapters = [chapter("one", 1), chapter("three", 3)];
    const store = createProjectStore(initial);
    const nextProject = { ...initial.project, revision: 2 };

    store
      .getState()
      .replaceChaptersLocal(nextProject, [chapter("one", 1), chapter("two", 2)]);

    expect(store.getState().project.revision).toBe(2);
    expect(store.getState().chapters.map((item) => item.order)).toEqual([1, 2]);
  });

  it("rejects stale stamped mutations across project slices", () => {
    const initial = projectData("a", 3);
    const store = createProjectStore(initial);
    const section = WorldSectionSchema.parse({
      id: "world-1",
      category: "history",
      title: "旧纪元",
      content: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const note = PlotNoteSchema.parse({
      id: "plot-1",
      type: "plan",
      title: "计划",
      content: "",
      status: "idea",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    store
      .getState()
      .commitWorldLocal({ ...initial.project, revision: 2 }, section);
    expect(store.getState().worldbuilding).toEqual([]);

    store
      .getState()
      .commitWorldLocal({ ...initial.project, revision: 4 }, section);
    store
      .getState()
      .replacePlotNotesLocal({ ...initial.project, revision: 5 }, [note]);
    expect(store.getState().project.revision).toBe(5);
    expect(store.getState().worldbuilding).toEqual([section]);
    expect(store.getState().plotNotes).toEqual([note]);
  });
});
