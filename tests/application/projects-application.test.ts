import { describe, expect, it } from "vitest";
import {
  createProjectsApplication,
  type NovelProject,
  type ProjectEventOutbox,
  type ProjectListFilter,
  type ProjectPage,
  type ProjectRepository,
  type ProjectTransaction,
  type ProjectUnitOfWork,
  type ProjectsApplication,
} from "@/modules/projects";
import type { EventEnvelope } from "@/shared/contracts";

const PROJECT_ID = "018f47a2-9000-7f11-8d24-4a1cc5e6d710";
const CLOCK = new Date("2026-08-31T04:00:00.000Z");

class MemoryProjectRepository implements ProjectRepository {
  catalogVersion = 0;
  readonly projects = new Map<string, NovelProject>();
  rejectNextUpdate = false;

  findById(projectId: string): NovelProject | undefined {
    return this.projects.get(projectId);
  }

  insert(
    _transaction: ProjectTransaction,
    project: NovelProject,
  ): number {
    this.projects.set(project.id, project);
    this.catalogVersion += 1;
    return this.catalogVersion;
  }

  list(filter: ProjectListFilter): ProjectPage {
    const items = [...this.projects.values()]
      .filter(
        (project) =>
          (!filter.status || project.status === filter.status) &&
          (filter.includeArchived || project.status !== "archived"),
      )
      .slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize);
    return {
      catalogVersion: this.catalogVersion,
      items,
      page: filter.page,
      pageSize: filter.pageSize,
      total: items.length,
      totalPages: items.length === 0 ? 0 : 1,
    };
  }

  update(
    _transaction: ProjectTransaction,
    project: NovelProject,
    expectedVersion: number,
  ): number | false {
    if (this.rejectNextUpdate) {
      this.rejectNextUpdate = false;
      return false;
    }
    const current = this.projects.get(project.id);
    if (!current || current.version !== expectedVersion) {
      return false;
    }
    this.projects.set(project.id, project);
    this.catalogVersion += 1;
    return this.catalogVersion;
  }
}

class RecordingOutbox implements ProjectEventOutbox {
  readonly events: EventEnvelope[] = [];

  enqueue(
    _transaction: ProjectTransaction,
    envelope: EventEnvelope,
  ): void {
    this.events.push(envelope);
  }
}

const unitOfWork: ProjectUnitOfWork = {
  run: (work) => work({ resource: "memory" }),
};

function createFixture() {
  const repository = new MemoryProjectRepository();
  const outbox = new RecordingOutbox();
  let eventSequence = 0;
  const application = createProjectsApplication({
    clock: () => CLOCK,
    eventIdGenerator: () => `event-${++eventSequence}`,
    idGenerator: () => PROJECT_ID,
    outbox,
    repository,
    unitOfWork,
  });
  return { application, outbox, repository };
}

function createInput() {
  return {
    genre: "悬疑",
    premise: "失忆校对员发现错字可以改写现实。",
    targetAudience: "成年类型文学读者",
    targetWordCount: 180_000,
    title: "纸上迷城",
  };
}

function unwrap<T>(
  result: ReturnType<ProjectsApplication[keyof ProjectsApplication]>,
): T {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value as T;
}

describe("项目 application commands 与 queries", () => {
  it("创建项目并在同一工作单元登记版本匹配的事件", () => {
    const fixture = createFixture();

    const result = fixture.application.createProject(createInput(), {
      actorId: "author-1",
      correlationId: "request-create",
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ catalogVersion: 1 });
    const project = unwrap<NovelProject>(result);
    expect(project).toMatchObject({
      id: PROJECT_ID,
      projectSequence: 1,
      status: "planning",
      version: 1,
    });
    expect(fixture.outbox.events).toHaveLength(1);
    expect(fixture.outbox.events[0]).toMatchObject({
      aggregate: {
        aggregateId: PROJECT_ID,
        aggregateType: "project",
        module: "projects",
        version: 1,
      },
      correlationId: "request-create",
      eventName: "projects.project.created.v1",
      metadata: { actorId: "author-1", schemaVersion: 1 },
      payload: {
        projectId: PROJECT_ID,
        status: "planning",
      },
    });
  });

  it("读取与分页查询返回 typed not-found 或项目页", () => {
    const fixture = createFixture();
    unwrap(
      fixture.application.createProject(createInput(), {
        correlationId: "request-create",
      }),
    );

    expect(fixture.application.getProject(PROJECT_ID)).toMatchObject({
      ok: true,
      value: { id: PROJECT_ID },
    });
    expect(
      fixture.application.getProject(
        "018f47a2-9000-7f11-8d24-4a1cc5e6d799",
      ),
    ).toEqual({
      error: {
        code: "projects.not_found",
        kind: "not_found",
        message: "作品不存在",
        retryable: false,
      },
      ok: false,
    });
    expect(
      fixture.application.listProjects({ page: 1, pageSize: 12 }),
    ).toMatchObject({
      ok: true,
      value: { page: 1, pageSize: 12, total: 1 },
    });
  });

  it("编辑元信息、目标和模型偏好只提交一个 updated 事件", () => {
    const fixture = createFixture();
    const created = unwrap<NovelProject>(
      fixture.application.createProject(createInput(), {
        correlationId: "request-create",
      }),
    );

    const result = fixture.application.updateProject(
      {
        expectedVersion: created.version,
        patch: {
          modelPreferences: {
            review: "review-model",
            writing: "writer-model",
          },
          targetWordCount: 220_000,
          title: "墨痕迷城",
        },
        projectId: created.id,
      },
      { correlationId: "request-update" },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        projectSequence: 2,
        title: "墨痕迷城",
        version: 2,
      },
    });
    expect(fixture.outbox.events).toHaveLength(2);
    expect(fixture.outbox.events[1]).toMatchObject({
      aggregate: { version: 2 },
      eventName: "projects.project.updated.v1",
      payload: {
        changedFields: [
          "modelPreferences",
          "targetWordCount",
          "title",
        ],
        projectId: PROJECT_ID,
      },
    });
  });

  it("预检和提交时的版本冲突均不登记事件", () => {
    const fixture = createFixture();
    const created = unwrap<NovelProject>(
      fixture.application.createProject(createInput(), {
        correlationId: "request-create",
      }),
    );

    const stale = fixture.application.updateProject(
      {
        expectedVersion: 99,
        patch: { title: "不会写入" },
        projectId: created.id,
      },
      { correlationId: "request-stale" },
    );
    fixture.repository.rejectNextUpdate = true;
    const raced = fixture.application.updateProject(
      {
        expectedVersion: 1,
        patch: { title: "也不会写入" },
        projectId: created.id,
      },
      { correlationId: "request-race" },
    );

    for (const result of [stale, raced]) {
      expect(result).toMatchObject({
        error: {
          code: "projects.version_conflict",
          details: { actualVersion: 1 },
          kind: "conflict",
        },
        ok: false,
      });
    }
    expect(fixture.repository.findById(PROJECT_ID)?.version).toBe(1);
    expect(fixture.outbox.events).toHaveLength(1);
  });

  it("状态迁移、归档和恢复各自产生合法且版本匹配的事件", () => {
    const fixture = createFixture();
    const created = unwrap<NovelProject>(
      fixture.application.createProject(createInput(), {
        correlationId: "request-create",
      }),
    );
    const writing = unwrap<NovelProject>(
      fixture.application.transitionProject(
        {
          expectedVersion: created.version,
          projectId: created.id,
          status: "writing",
        },
        { correlationId: "request-status" },
      ),
    );
    const archived = unwrap<NovelProject>(
      fixture.application.archiveProject(
        {
          expectedVersion: writing.version,
          projectId: writing.id,
        },
        { correlationId: "request-archive" },
      ),
    );
    const restored = unwrap<NovelProject>(
      fixture.application.restoreProject(
        {
          expectedVersion: archived.version,
          projectId: archived.id,
        },
        { correlationId: "request-restore" },
      ),
    );

    expect(restored).toMatchObject({
      projectSequence: 4,
      status: "writing",
      version: 4,
    });
    expect(
      fixture.outbox.events.slice(1).map((event) => [
        event.eventName,
        event.aggregate.version,
      ]),
    ).toEqual([
      ["projects.project.status_changed.v1", 2],
      ["projects.project.archived.v1", 3],
      ["projects.project.restored.v1", 4],
    ]);
  });

  it("非法迁移返回 validation 且不修改状态或登记事件", () => {
    const fixture = createFixture();
    const created = unwrap<NovelProject>(
      fixture.application.createProject(createInput(), {
        correlationId: "request-create",
      }),
    );

    const result = fixture.application.transitionProject(
      {
        expectedVersion: created.version,
        projectId: created.id,
        status: "completed",
      },
      { correlationId: "request-invalid-status" },
    );

    expect(result).toMatchObject({
      error: {
        code: "projects.invalid_status_transition",
        kind: "validation",
      },
      ok: false,
    });
    expect(fixture.repository.findById(PROJECT_ID)?.status).toBe("planning");
    expect(fixture.outbox.events).toHaveLength(1);
  });
});
