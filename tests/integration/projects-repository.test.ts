import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DatabaseSync,
  SQLInputValue,
  StatementSync,
} from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "@/platform/database";
import {
  archiveNovelProject,
  createNovelProject,
  updateNovelProject,
} from "@/modules/projects/domain/project";
import { createSqliteProjectRepository } from "@/modules/projects/infrastructure/sqlite-project-repository";

const directories: string[] = [];

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "ai-novel-projects-repo-"));
  directories.push(directory);
  const connection = createSqliteDatabase({
    filePath: join(directory, "projects.sqlite"),
  });
  return {
    connection,
    repository: createSqliteProjectRepository(connection),
  };
}

function createProject(
  id: string,
  title: string,
  genre = "悬疑",
  now = "2026-08-31T00:00:00.000Z",
) {
  return createNovelProject(
    {
      genre,
      modelPreferences: {
        chat: "deepseek-v4-flash",
        embedding: null,
        review: null,
        writing: "deepseek-v4-pro",
      },
      premise: `${title}的核心故事梗概`,
      targetAudience: "成年类型文学读者",
      targetWordCount: 180_000,
      title,
    },
    { id, now },
  );
}

function hookAfterFirstProjectRead(
  client: DatabaseSync,
  callback: () => void,
): () => number {
  const prepare = client.prepare.bind(client);
  let callbackCalled = false;
  let readExecutions = 0;

  Object.defineProperty(client, "prepare", {
    configurable: true,
    value(sql: string): StatementSync {
      const statement = prepare(sql);
      if (!/\bSELECT\b[\s\S]*\bFROM\s+projects\b/i.test(sql)) {
        return statement;
      }
      const afterRead = () => {
        readExecutions += 1;
        if (!callbackCalled) {
          callbackCalled = true;
          callback();
        }
      };
      return new Proxy(statement, {
        get(target, property) {
          if (property === "get") {
            return (...parameters: SQLInputValue[]) => {
              const result = target.get(...parameters);
              afterRead();
              return result;
            };
          }
          if (property === "all") {
            return (...parameters: SQLInputValue[]) => {
              const result = target.all(...parameters);
              afterRead();
              return result;
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function"
            ? value.bind(target)
            : value;
        },
      });
    },
  });

  return () => readExecutions;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("项目 SQLite 仓储与迁移", () => {
  it("连接初始化通过真实迁移创建项目与模型偏好表", () => {
    const fixture = createFixture();

    try {
      const tables = fixture.connection.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
      const preferenceColumns = fixture.connection.client
        .prepare("PRAGMA table_info(project_model_preferences)")
        .all()
        .map((row) => row.name);

      expect(tables).toEqual(
        expect.arrayContaining([
          "project_catalog_state",
          "project_model_preferences",
          "projects",
        ]),
      );
      expect(
        fixture.connection.client
          .prepare(
            "SELECT id, version FROM project_catalog_state",
          )
          .get(),
      ).toEqual({ id: 1, version: 0 });
      expect(preferenceColumns).toEqual([
        "project_id",
        "role",
        "model_id",
      ]);
      expect(preferenceColumns).not.toContain("api_key");
    } finally {
      fixture.connection.close();
    }
  });

  it("在 UnitOfWork 中持久化并完整还原项目与角色模型偏好", () => {
    const fixture = createFixture();
    const project = createProject(
      "018f47a2-9000-7f11-8d24-4a1cc5e6d701",
      "纸上迷城",
    );

    try {
      const catalogVersion = fixture.connection.unitOfWork.run(
        (resource) => fixture.repository.insert({ resource }, project),
      );

      expect(catalogVersion).toBe(1);
      expect(fixture.repository.findById(project.id)).toEqual(project);
      expect(
        fixture.connection.client
          .prepare(
            "SELECT role, model_id FROM project_model_preferences WHERE project_id = ? ORDER BY role",
          )
          .all(project.id),
      ).toEqual([
        { model_id: "deepseek-v4-flash", role: "chat" },
        { model_id: "deepseek-v4-pro", role: "writing" },
      ]);
    } finally {
      fixture.connection.close();
    }
  });

  it("以 expectedVersion 原子更新，冲突不留下部分设置", () => {
    const fixture = createFixture();
    const project = createProject(
      "018f47a2-9000-7f11-8d24-4a1cc5e6d702",
      "旧标题",
    );
    const updated = updateNovelProject(
      project,
      {
        modelPreferences: {
          chat: null,
          review: "review-model",
          writing: "writing-model",
        },
        title: "新标题",
      },
      "2026-08-31T01:00:00.000Z",
    );

    try {
      fixture.connection.unitOfWork.run((resource) => {
        fixture.repository.insert({ resource }, project);
      });
      const conflicted = fixture.connection.unitOfWork.run((resource) =>
        fixture.repository.update({ resource }, updated, 99),
      );

      expect(conflicted).toBe(false);
      expect(fixture.repository.findById(project.id)).toEqual(project);

      const committed = fixture.connection.unitOfWork.run((resource) =>
        fixture.repository.update({ resource }, updated, 1),
      );
      expect(committed).toBe(2);
      expect(fixture.repository.findById(project.id)).toEqual(updated);
    } finally {
      fixture.connection.close();
    }
  });

  it("分页列表支持搜索、题材与状态筛选且默认排除归档", () => {
    const fixture = createFixture();
    const projects = [
      createProject(
        "018f47a2-9000-7f11-8d24-4a1cc5e6d703",
        "雨巷来信",
        "悬疑",
        "2026-08-31T00:00:00.000Z",
      ),
      createProject(
        "018f47a2-9000-7f11-8d24-4a1cc5e6d704",
        "纸月航线",
        "科幻",
        "2026-08-31T01:00:00.000Z",
      ),
      archiveNovelProject(
        createProject(
          "018f47a2-9000-7f11-8d24-4a1cc5e6d705",
          "旧纸迷踪",
          "悬疑",
          "2026-08-31T02:00:00.000Z",
        ),
        "2026-08-31T03:00:00.000Z",
      ),
    ];

    try {
      fixture.connection.unitOfWork.run((resource) => {
        for (const project of projects) {
          fixture.repository.insert({ resource }, project);
        }
      });

      expect(
        fixture.repository.list({ page: 1, pageSize: 1 }),
      ).toMatchObject({
        fetchedAt: expect.any(Number),
        catalogVersion: 3,
        items: [{ title: "纸月航线" }],
        page: 1,
        pageSize: 1,
        total: 2,
      });
      expect(
        fixture.repository.list({
          genre: "悬疑",
          includeArchived: true,
          page: 1,
          pageSize: 10,
          search: "纸",
        }),
      ).toMatchObject({
        items: [{ status: "archived", title: "旧纸迷踪" }],
        total: 1,
      });
      expect(
        fixture.repository.list({
          page: 1,
          pageSize: 10,
          status: "archived",
        }).items,
      ).toHaveLength(1);
    } finally {
      fixture.connection.close();
    }
  });

  it("单项目与模型偏好来自同一读取快照", () => {
    const fixture = createFixture();
    const project = createProject(
      "018f47a2-9000-7f11-8d24-4a1cc5e6d707",
      "快照旧稿",
    );
    const concurrent = createSqliteDatabase({
      filePath: fixture.connection.filePath,
    });

    try {
      fixture.connection.unitOfWork.run((resource) => {
        fixture.repository.insert({ resource }, project);
      });
      const readExecutions = hookAfterFirstProjectRead(
        fixture.connection.client,
        () => {
          concurrent.unitOfWork.run((resource) => {
            resource.client
              .prepare(
                `UPDATE projects
                 SET title = ?, version = 2, project_sequence = 2,
                     updated_at = ?
                 WHERE id = ?`,
              )
              .run(
                "快照新稿",
                "2026-08-31T01:00:00.000Z",
                project.id,
              );
            resource.client
              .prepare(
                `UPDATE project_model_preferences
                 SET model_id = ?
                 WHERE project_id = ? AND role = 'chat'`,
              )
              .run("new-chat-model", project.id);
          });
        },
      );

      expect(fixture.repository.findById(project.id)).toEqual(project);
      expect(readExecutions()).toBe(1);
      expect(
        concurrent.client
          .prepare(
            "SELECT title FROM projects WHERE id = ?",
          )
          .get(project.id),
      ).toEqual({ title: "快照新稿" });
    } finally {
      concurrent.close();
      fixture.connection.close();
    }
  });

  it("列表总数、分页项目与偏好来自单条查询快照且无 N+1", () => {
    const fixture = createFixture();
    const initial = createProject(
      "018f47a2-9000-7f11-8d24-4a1cc5e6d708",
      "列表旧稿",
    );
    const concurrentProject = createProject(
      "018f47a2-9000-7f11-8d24-4a1cc5e6d709",
      "并发新稿",
      "科幻",
      "2026-08-31T01:00:00.000Z",
    );
    const concurrent = createSqliteDatabase({
      filePath: fixture.connection.filePath,
    });
    const concurrentRepository =
      createSqliteProjectRepository(concurrent);

    try {
      fixture.connection.unitOfWork.run((resource) => {
        fixture.repository.insert({ resource }, initial);
      });
      const readExecutions = hookAfterFirstProjectRead(
        fixture.connection.client,
        () => {
          concurrent.unitOfWork.run((resource) => {
            concurrentRepository.insert(
              { resource },
              concurrentProject,
            );
          });
        },
      );

      const page = fixture.repository.list({
        page: 1,
        pageSize: 12,
      });

      expect(page).toMatchObject({
        items: [{ id: initial.id, modelPreferences: initial.modelPreferences }],
        total: 1,
      });
      expect(readExecutions()).toBe(1);
      expect(
        concurrent.client
          .prepare("SELECT count(*) AS total FROM projects")
          .get(),
      ).toEqual({ total: 2 });
    } finally {
      concurrent.close();
      fixture.connection.close();
    }
  });

  it("默认活跃列表使用专用索引且无需临时排序", () => {
    const fixture = createFixture();

    try {
      const plan = fixture.connection.client
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM projects
           WHERE status <> 'archived'
           ORDER BY updated_at DESC, id ASC
           LIMIT 12 OFFSET 0`,
        )
        .all()
        .map((row) => String(row.detail))
        .join("\n");

      expect(plan).toContain(
        "USING INDEX projects_active_updated_id_idx",
      );
      expect(plan).not.toContain("USE TEMP B-TREE");
    } finally {
      fixture.connection.close();
    }
  });

  it("同一数据库重连后迁移幂等且项目数据仍可读取", () => {
    const fixture = createFixture();
    const filePath = fixture.connection.filePath;
    const project = createProject(
      "018f47a2-9000-7f11-8d24-4a1cc5e6d706",
      "重开之书",
    );

    fixture.connection.unitOfWork.run((resource) => {
      fixture.repository.insert({ resource }, project);
    });
    fixture.connection.close();

    const reopened = createSqliteDatabase({ filePath });
    try {
      expect(
        createSqliteProjectRepository(reopened).findById(project.id),
      ).toEqual(project);
    } finally {
      reopened.close();
    }
  });
});
