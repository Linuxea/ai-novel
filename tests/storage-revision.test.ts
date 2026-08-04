import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSummaryInputFingerprint } from "@/lib/artifact-fingerprint";

const dataDir = path.join(
  "/tmp/opencode",
  `ai-novel-test-${process.pid}-${Date.now()}`,
);

type Storage = typeof import("@/lib/storage");
type ProjectCommands = typeof import("@/lib/application/project-commands");
let storage: Storage;
let commands: ProjectCommands;

beforeAll(async () => {
  process.env.DATA_DIR = dataDir;
  storage = await import("@/lib/storage");
  commands = await import("@/lib/application/project-commands");
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("chapter revisions", () => {
  it("rejects stale content and stale summary commits", async () => {
    const project = await storage.createProject({ title: "测试项目" });
    const chapter = await storage.createChapter(project.id, { title: "第一章" });

    const saved = await storage.writeChapterContent(
      project.id,
      chapter.id,
      "第一版正文",
      0,
    );
    expect(saved.contentRevision).toBe(1);

    await expect(
      storage.writeChapterContent(project.id, chapter.id, "陈旧覆盖", 0),
    ).rejects.toBeInstanceOf(storage.RevisionConflictError);

    const currentProject = await storage.getProject(project.id);
    expect(currentProject).not.toBeNull();
    const summaryFingerprint = buildSummaryInputFingerprint(
      currentProject!,
      saved,
      2,
    );
    const withSummary = await storage.updateChapterSummary(
      project.id,
      chapter.id,
      "摘要",
      saved.contentHash,
      saved.contentRevision,
      summaryFingerprint,
      2,
    );
    expect(withSummary.summary).toBe("摘要");
    expect(
      buildSummaryInputFingerprint(currentProject!, withSummary, 2),
    ).toBe(summaryFingerprint);

    const newer = await storage.writeChapterContent(
      project.id,
      chapter.id,
      "第二版正文",
      saved.contentRevision,
    );
    await expect(
      storage.updateChapterSummary(
        project.id,
        chapter.id,
        "旧摘要",
        saved.contentHash,
        saved.contentRevision,
        summaryFingerprint,
        2,
      ),
    ).rejects.toBeInstanceOf(storage.RevisionConflictError);
    expect(newer.contentRevision).toBe(2);
  });

  it("keeps chapter and summary RAG records for the same owner", async () => {
    const project = await storage.createProject({ title: "RAG 测试" });
    const chapter = await storage.createChapter(project.id, { title: "钥匙" });
    const saved = await storage.writeChapterContent(
      project.id,
      chapter.id,
      "远古钥匙藏在石门后。",
      0,
    );
    const currentProject = await storage.getProject(project.id);
    const summaryFingerprint = buildSummaryInputFingerprint(
      currentProject!,
      saved,
      2,
    );
    await storage.updateChapterSummary(
      project.id,
      chapter.id,
      "主角发现了远古钥匙。",
      saved.contentHash,
      saved.contentRevision,
      summaryFingerprint,
      2,
    );

    const records = await storage.readRagIndex(project.id);
    const sources = records
      .filter((record) => record.chunk.ownerId === chapter.id)
      .map((record) => record.chunk.source)
      .sort();
    expect(sources).toEqual(["chapter", "summary"]);
  });

  it("excludes the current and future chapters from retrieval", async () => {
    const project = await storage.createProject({ title: "检索边界" });
    const first = await storage.createChapter(project.id, {
      title: "过去",
      order: 1,
    });
    const current = await storage.createChapter(project.id, {
      title: "现在",
      order: 2,
    });
    const future = await storage.createChapter(project.id, {
      title: "未来",
      order: 3,
    });
    await storage.writeChapterContent(project.id, first.id, "远古钥匙出现", 0);
    await storage.writeChapterContent(project.id, current.id, "远古钥匙再现", 0);
    await storage.writeChapterContent(project.id, future.id, "远古钥匙真相", 0);

    const { retrieveContext } = await import("@/lib/rag/retrieve");
    const hits = await retrieveContext(
      project.id,
      {
        outline: "远古钥匙",
        characterNames: [],
        pendingForeshadowTitles: [],
        excludeOwnerIds: [current.id],
        maxChapterOrder: 1,
      },
      10,
    );

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.ownerId === first.id)).toBe(true);
  });

  it("records the chapter when a foreshadow is resolved", async () => {
    const project = await storage.createProject({ title: "伏笔状态" });
    const chapter = await storage.createChapter(project.id, {
      title: "揭晓",
      order: 1,
    });
    const note = await storage.createPlotNote(project.id, {
      type: "foreshadow",
      title: "旧信",
    });

    const resolved = await storage.resolvePlotNote(
      project.id,
      note.id,
      chapter.id,
    );
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedInChapter).toBe(chapter.order);
  });

  it("returns the canonical chapter order after deletion", async () => {
    const project = await storage.createProject({ title: "章节重排" });
    await storage.createChapter(project.id, { title: "第一章" });
    const second = await storage.createChapter(project.id, { title: "第二章" });
    await storage.createChapter(project.id, { title: "第三章" });

    const result = await commands.deleteChapterCommand(
      project.id,
      second.id,
    );

    expect(result.chapters.map((item) => item.order)).toEqual([1, 2]);
    expect(result.project.revision).toBeGreaterThan(project.revision);
  });

  it("commits generated outlines only against the source snapshot", async () => {
    const project = await storage.createProject({ title: "大纲 CAS" });
    const chapter = await storage.createChapter(project.id, {
      title: "第一章",
      outline: "旧大纲",
    });
    const saved = await storage.writeChapterContent(
      project.id,
      chapter.id,
      "正文",
      0,
    );
    const snapshotProject = await storage.getProject(project.id);

    const committed = await commands.updateChapterOutlineCommand(
      project.id,
      chapter.id,
      "新大纲",
      {
        expectedProjectRevision: snapshotProject!.revision,
        expectedContentRevision: saved.contentRevision,
        expectedOutline: "旧大纲",
      },
    );
    expect(committed.chapter.outline).toBe("新大纲");

    await expect(
      commands.updateChapterOutlineCommand(
        project.id,
        chapter.id,
        "陈旧覆盖",
        {
          expectedProjectRevision: snapshotProject!.revision,
          expectedContentRevision: saved.contentRevision,
          expectedOutline: "旧大纲",
        },
      ),
    ).rejects.toBeInstanceOf(storage.RevisionConflictError);
  });

  it("returns revision-stamped snapshots for remaining project commands", async () => {
    const project = await storage.createProject({ title: "命令层" });
    const first = await commands.createCharacterCommand(project.id, {
      name: "甲",
    });
    const second = await commands.createCharacterCommand(project.id, {
      name: "乙",
    });
    const related = await commands.upsertRelationshipCommand(
      project.id,
      first.character.id,
      { targetId: second.character.id, type: "ally" },
    );
    expect(related.character.relationships).toHaveLength(1);

    const positioned = await commands.updateCharacterLayoutCommand(
      project.id,
      first.character.id,
      { x: 12, y: 34 },
    );
    expect(positioned.character.layoutPosition).toEqual({ x: 12, y: 34 });

    const world = await commands.createWorldSectionCommand(project.id, {
      category: "history",
      title: "旧纪元",
      content: "历史",
    });
    const deletedWorld = await commands.deleteWorldSectionCommand(
      project.id,
      world.section.id,
    );
    expect(deletedWorld.worldbuilding).toEqual([]);

    const plot = await commands.createPlotNoteCommand(project.id, {
      type: "plan",
      title: "下一步",
    });
    const deletedPlot = await commands.deletePlotNoteCommand(
      project.id,
      plot.note.id,
    );
    expect(deletedPlot.plotNotes).toEqual([]);
    expect(deletedPlot.project.revision).toBeGreaterThan(
      first.project.revision,
    );
  });

  it("isolates invalid sidecar data behind repository fallbacks", async () => {
    const project = await storage.createProject({ title: "Sidecar 边界" });
    const chapter = await storage.createChapter(project.id, { title: "第一章" });
    const current = await storage.getProject(project.id);
    const cache = {
      version: 1 as const,
      mode: "regenerate" as const,
      baseContentHash: "",
      outlineHash: "outline",
      contentRevision: chapter.contentRevision,
      projectRevision: current!.revision,
      modelId: "test-model",
      createdAt: new Date().toISOString(),
      sheet: {
        overallArc: "起承转合",
        beats: [
          { index: 1, summary: "开端", targetWords: 300 },
          { index: 2, summary: "转折", targetWords: 300 },
        ],
      },
    };

    expect(await storage.writeBeatSheet(project.id, chapter.id, cache)).toBe(true);
    expect(await storage.readBeatSheet(project.id, chapter.id)).toEqual(cache);

    await storage.writeProjectFiles(project.id, [
      { path: `chapters/${chapter.id}.beats.json`, content: "{}" },
      { path: "checks.json", content: `{"${chapter.id}":{"invalid":true}}` },
      { path: "rag/index.json", content: "{}" },
    ]);

    expect(await storage.readBeatSheet(project.id, chapter.id)).toBeNull();
    expect(await storage.getCheck(project.id, chapter.id)).toBeNull();
    expect(await storage.readRagIndex(project.id)).toEqual([]);
  });
});
