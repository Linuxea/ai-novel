import { describe, expect, it } from "vitest";
import {
  archiveNovelProject,
  createNovelProject,
  ProjectCreateInputSchema,
  restoreNovelProject,
  transitionNovelProject,
  updateNovelProject,
} from "@/modules/projects/domain/project";

const PROJECT_ID = "018f47a2-9000-7f11-8d24-4a1cc5e6d701";
const CREATED_AT = "2026-08-31T00:00:00.000Z";
const UPDATED_AT = "2026-08-31T01:00:00.000Z";

function createFixture() {
  return createNovelProject(
    {
      genre: "悬疑",
      premise: "一名失忆校对员发现，每改正一个错字，现实就会随之改变。",
      targetAudience: "喜爱都市奇幻与本格推理的成年读者",
      targetWordCount: 180_000,
      title: "纸上迷城",
    },
    { id: PROJECT_ID, now: CREATED_AT },
  );
}

describe("NovelProject 聚合", () => {
  it("创建时规范化字段并从 planning、版本 1 开始", () => {
    const project = createNovelProject(
      {
        genre: "  悬疑  ",
        modelPreferences: {
          chat: "deepseek-v4-flash",
          writing: null,
        },
        premise: "  字句能改写现实。  ",
        subtitle: "  校对员手记  ",
        targetAudience: "  成年读者  ",
        targetWordCount: 180_000,
        title: "  纸上迷城  ",
      },
      { id: PROJECT_ID, now: CREATED_AT },
    );

    expect(project).toMatchObject({
      archivedFromStatus: null,
      createdAt: CREATED_AT,
      genre: "悬疑",
      id: PROJECT_ID,
      modelPreferences: {
        chat: "deepseek-v4-flash",
        embedding: null,
        review: null,
        writing: null,
      },
      premise: "字句能改写现实。",
      projectSequence: 1,
      status: "planning",
      subtitle: "校对员手记",
      targetAudience: "成年读者",
      targetWordCount: 180_000,
      title: "纸上迷城",
      updatedAt: CREATED_AT,
      version: 1,
    });
  });

  it("为核心字段、目标字数与模型偏好执行明确边界", () => {
    expect(
      ProjectCreateInputSchema.safeParse({
        genre: "",
        modelPreferences: { apiKey: "secret" },
        premise: "",
        targetAudience: "",
        targetWordCount: 999,
        title: "x".repeat(81),
      }).success,
    ).toBe(false);
    expect(
      ProjectCreateInputSchema.safeParse({
        genre: "悬疑",
        premise: "x".repeat(2_001),
        targetAudience: "成年读者",
        targetWordCount: 10_000_001,
        title: "纸上迷城",
      }).success,
    ).toBe(false);
  });

  it("编辑元信息、创作目标和角色模型偏好只递增一次版本与序列", () => {
    const updated = updateNovelProject(
      createFixture(),
      {
        genre: "都市奇幻",
        modelPreferences: {
          chat: null,
          embedding: "bge-m3",
          review: "deepseek-v4-pro",
          writing: "deepseek-v4-pro",
        },
        premise: "一名校对员通过错字改写现实，并追查自己被抹去的过去。",
        subtitle: null,
        targetAudience: "偏爱烧脑叙事的成年读者",
        targetWordCount: 220_000,
        title: "墨痕迷城",
      },
      UPDATED_AT,
    );

    expect(updated.version).toBe(2);
    expect(updated.projectSequence).toBe(2);
    expect(updated.updatedAt).toBe(UPDATED_AT);
    expect(updated.title).toBe("墨痕迷城");
    expect(updated.modelPreferences.embedding).toBe("bge-m3");
  });

  it("拒绝无语义变化的编辑，避免虚增版本", () => {
    const project = createFixture();

    expect(() =>
      updateNovelProject(project, { title: ` ${project.title} ` }, UPDATED_AT),
    ).toThrowError(
      expect.objectContaining({
        code: "projects.no_changes",
      }),
    );
  });

  it("只允许定义的活跃状态迁移", () => {
    const planning = createFixture();
    const writing = transitionNovelProject(planning, "writing", UPDATED_AT);
    const revising = transitionNovelProject(
      writing,
      "revising",
      "2026-08-31T02:00:00.000Z",
    );
    const completed = transitionNovelProject(
      revising,
      "completed",
      "2026-08-31T03:00:00.000Z",
    );

    expect([writing.status, revising.status, completed.status]).toEqual([
      "writing",
      "revising",
      "completed",
    ]);
    expect(completed.version).toBe(4);
    expect(() =>
      transitionNovelProject(planning, "completed", UPDATED_AT),
    ).toThrowError(
      expect.objectContaining({
        code: "projects.invalid_status_transition",
      }),
    );
  });

  it("归档保存原状态，恢复后回到归档前状态且各递增一次", () => {
    const writing = transitionNovelProject(
      createFixture(),
      "writing",
      UPDATED_AT,
    );
    const archived = archiveNovelProject(
      writing,
      "2026-08-31T02:00:00.000Z",
    );
    const restored = restoreNovelProject(
      archived,
      "2026-08-31T03:00:00.000Z",
    );

    expect(archived).toMatchObject({
      archivedFromStatus: "writing",
      projectSequence: 3,
      status: "archived",
      version: 3,
    });
    expect(restored).toMatchObject({
      archivedFromStatus: null,
      projectSequence: 4,
      status: "writing",
      version: 4,
    });
  });

  it("归档与恢复命令拒绝不适用的当前状态", () => {
    const project = createFixture();

    expect(() => restoreNovelProject(project, UPDATED_AT)).toThrowError(
      expect.objectContaining({
        code: "projects.not_archived",
      }),
    );
    expect(() =>
      archiveNovelProject(
        archiveNovelProject(project, UPDATED_AT),
        "2026-08-31T02:00:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "projects.already_archived",
      }),
    );
  });
});
