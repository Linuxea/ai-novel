import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  ProjectApiErrorResponseSchema,
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
} from "@/modules/projects";
import {
  closeDatabaseSingleton,
  createSqliteDatabase,
  getDatabaseSingleton,
} from "@/platform/database";
import {
  GET as listProjects,
  POST as createProject,
} from "@/app/api/v1/projects/route";
import {
  GET as getProject,
  PATCH as patchProject,
} from "@/app/api/v1/projects/[projectId]/route";
import { POST as archiveProject } from "@/app/api/v1/projects/[projectId]/archive/route";
import { POST as restoreProject } from "@/app/api/v1/projects/[projectId]/restore/route";
import { projectResultResponse } from "@/app/api/v1/projects/http";

const directory = mkdtempSync(join(tmpdir(), "ai-novel-projects-api-"));
const databasePath = join(directory, "api.sqlite");

function request(
  url: string,
  method: string,
  body?: unknown,
): NextRequest {
  return new NextRequest(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers:
      body === undefined
        ? undefined
        : { "content-type": "application/json" },
    method,
  });
}

function createBody(title = "纸上迷城") {
  return {
    genre: "悬疑",
    premise: `${title}讲述校对员通过错字改写现实的故事。`,
    targetAudience: "成年类型文学读者",
    targetWordCount: 180_000,
    title,
  };
}

async function createOne(title = "纸上迷城") {
  const response = await createProject(
    request("http://localhost/api/v1/projects", "POST", createBody(title)),
  );
  return ProjectDetailResponseSchema.parse(await response.json()).data;
}

beforeAll(() => {
  process.env.DATABASE_PATH = databasePath;
  closeDatabaseSingleton();
  const migrated = createSqliteDatabase({ filePath: databasePath });
  migrated.close();
});

beforeEach(() => {
  const connection = getDatabaseSingleton({ filePath: databasePath });
  connection.unitOfWork.run(({ client }) => {
    client.exec(
      "DELETE FROM project_model_preferences; DELETE FROM projects; DELETE FROM domain_events",
    );
  });
});

afterAll(() => {
  closeDatabaseSingleton();
  delete process.env.DATABASE_PATH;
  rmSync(directory, { force: true, recursive: true });
});

describe("API v1 项目合同", () => {
  it("创建与分页列表使用统一响应 schema 和筛选参数", async () => {
    const created = await createOne();
    await createOne("远星回声");

    expect(created).toMatchObject({
      status: "planning",
      title: "纸上迷城",
      version: 1,
    });
    const response = await listProjects(
      request(
        "http://localhost/api/v1/projects?page=1&pageSize=1&search=%E7%BA%B8&genre=%E6%82%AC%E7%96%91",
        "GET",
      ),
    );
    const rawBody = await response.json();

    expect(response.status, JSON.stringify(rawBody)).toBe(200);
    const body = ProjectListResponseSchema.parse(rawBody);
    expect(body).toMatchObject({
      data: [{ id: created.id, title: "纸上迷城" }],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    });
    expect(JSON.stringify(body)).not.toContain("apiKey");
  });

  it("动态详情路由读取 await params 并映射 404", async () => {
    const created = await createOne();
    const found = await getProject(
      request(`http://localhost/api/v1/projects/${created.id}`, "GET"),
      { params: Promise.resolve({ projectId: created.id }) },
    );
    const missing = await getProject(
      request(
        "http://localhost/api/v1/projects/018f47a2-9000-7f11-8d24-4a1cc5e6d799",
        "GET",
      ),
      {
        params: Promise.resolve({
          projectId: "018f47a2-9000-7f11-8d24-4a1cc5e6d799",
        }),
      },
    );

    expect(found.status).toBe(200);
    expect(
      ProjectDetailResponseSchema.parse(await found.json()).data.id,
    ).toBe(created.id);
    expect(missing.status).toBe(404);
    expect(
      ProjectApiErrorResponseSchema.parse(await missing.json()),
    ).toMatchObject({
      error: { code: "projects.not_found", kind: "not_found" },
    });
  });

  it("路径参数格式错误属于 400 请求错误", async () => {
    const response = await getProject(
      request("http://localhost/api/v1/projects/not-a-uuid", "GET"),
      { params: Promise.resolve({ projectId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(
      ProjectApiErrorResponseSchema.parse(await response.json()),
    ).toMatchObject({
      error: {
        code: "projects.invalid_request",
        kind: "validation",
      },
    });
  });

  it("PATCH 编辑和状态迁移均要求 expectedVersion", async () => {
    const created = await createOne();
    const updatedResponse = await patchProject(
      request(
        `http://localhost/api/v1/projects/${created.id}`,
        "PATCH",
        {
          action: "update",
          expectedVersion: created.version,
          patch: {
            modelPreferences: { writing: "writer-model" },
            targetWordCount: 240_000,
            title: "墨痕迷城",
          },
        },
      ),
      { params: Promise.resolve({ projectId: created.id }) },
    );
    const updated = ProjectDetailResponseSchema.parse(
      await updatedResponse.json(),
    ).data;
    const transitionedResponse = await patchProject(
      request(
        `http://localhost/api/v1/projects/${created.id}`,
        "PATCH",
        {
          action: "transition",
          expectedVersion: updated.version,
          status: "writing",
        },
      ),
      { params: Promise.resolve({ projectId: created.id }) },
    );
    const transitioned = ProjectDetailResponseSchema.parse(
      await transitionedResponse.json(),
    ).data;

    expect(updated).toMatchObject({
      projectSequence: 2,
      title: "墨痕迷城",
      version: 2,
    });
    expect(transitioned).toMatchObject({
      projectSequence: 3,
      status: "writing",
      version: 3,
    });
  });

  it("归档默认退出列表，恢复到归档前状态", async () => {
    const created = await createOne();
    const writingResponse = await patchProject(
      request(
        `http://localhost/api/v1/projects/${created.id}`,
        "PATCH",
        {
          action: "transition",
          expectedVersion: created.version,
          status: "writing",
        },
      ),
      { params: Promise.resolve({ projectId: created.id }) },
    );
    const writing = ProjectDetailResponseSchema.parse(
      await writingResponse.json(),
    ).data;
    const archivedResponse = await archiveProject(
      request(
        `http://localhost/api/v1/projects/${created.id}/archive`,
        "POST",
        { expectedVersion: writing.version },
      ),
      { params: Promise.resolve({ projectId: created.id }) },
    );
    const archived = ProjectDetailResponseSchema.parse(
      await archivedResponse.json(),
    ).data;
    const activeList = await listProjects(
      request("http://localhost/api/v1/projects", "GET"),
    );
    const archivedList = await listProjects(
      request(
        "http://localhost/api/v1/projects?status=archived",
        "GET",
      ),
    );
    const restoredResponse = await restoreProject(
      request(
        `http://localhost/api/v1/projects/${created.id}/restore`,
        "POST",
        { expectedVersion: archived.version },
      ),
      { params: Promise.resolve({ projectId: created.id }) },
    );
    const restored = ProjectDetailResponseSchema.parse(
      await restoredResponse.json(),
    ).data;

    expect(archived.status).toBe("archived");
    expect(
      ProjectListResponseSchema.parse(await activeList.json()).data,
    ).toEqual([]);
    expect(
      ProjectListResponseSchema.parse(await archivedList.json()).data,
    ).toHaveLength(1);
    expect(restored).toMatchObject({
      status: "writing",
      version: 4,
    });
  });

  it("区分请求错误、领域校验和乐观并发冲突", async () => {
    const created = await createOne();
    const invalidRequest = await createProject(
      request("http://localhost/api/v1/projects", "POST", {
        ...createBody(),
        title: "",
      }),
    );
    const invalidTransition = await patchProject(
      request(
        `http://localhost/api/v1/projects/${created.id}`,
        "PATCH",
        {
          action: "transition",
          expectedVersion: created.version,
          status: "completed",
        },
      ),
      { params: Promise.resolve({ projectId: created.id }) },
    );
    const conflict = await patchProject(
      request(
        `http://localhost/api/v1/projects/${created.id}`,
        "PATCH",
        {
          action: "update",
          expectedVersion: 99,
          patch: { title: "不会写入" },
        },
      ),
      { params: Promise.resolve({ projectId: created.id }) },
    );

    expect(invalidRequest.status).toBe(400);
    expect(invalidTransition.status).toBe(422);
    expect(conflict.status).toBe(409);
    expect(
      ProjectApiErrorResponseSchema.parse(await conflict.json()),
    ).toMatchObject({
      error: {
        code: "projects.version_conflict",
        details: { actualVersion: 1, expectedVersion: 99 },
      },
    });
  });

  it("意外错误统一映射为无内部细节的 500", async () => {
    const response = projectResultResponse({
      error: {
        causeId: "cause-api",
        code: "projects.internal",
        kind: "internal",
        message: "作品操作暂时无法完成",
        retryable: false,
      },
      ok: false,
    });
    const body = ProjectApiErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        causeId: "cause-api",
        code: "projects.internal",
        kind: "internal",
        message: "作品操作暂时无法完成",
        retryable: false,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/sqlite|stack|sql/i);
  });
});
