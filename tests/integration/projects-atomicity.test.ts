import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectEventOutbox } from "@/modules/projects";
import { createSqliteDatabase } from "@/platform/database";
import { createOutboxRepository } from "@/platform/events";
import { createSqliteProjectRepository } from "@/modules/projects/infrastructure/sqlite-project-repository";
import { composeProjectsApplication } from "@/modules/projects/infrastructure/composition";

const directories: string[] = [];

function createFixture(outboxOverride?: ProjectEventOutbox) {
  const directory = mkdtempSync(join(tmpdir(), "ai-novel-projects-atomic-"));
  directories.push(directory);
  const connection = createSqliteDatabase({
    filePath: join(directory, "projects.sqlite"),
  });
  const repository = createSqliteProjectRepository(connection);
  const platformOutbox = createOutboxRepository(connection);
  const application = composeProjectsApplication(connection, {
    causeIdGenerator: () => "cause-project-test",
    clock: () => new Date("2026-08-31T05:00:00.000Z"),
    eventIdGenerator: () => "event-project-created",
    idGenerator: () => "018f47a2-9000-7f11-8d24-4a1cc5e6d720",
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    outbox: outboxOverride,
  });
  return { application, connection, platformOutbox, repository };
}

function createInput() {
  return {
    genre: "悬疑",
    premise: "每一次校对都会改变现实。",
    targetAudience: "成年类型文学读者",
    targetWordCount: 180_000,
    title: "纸上迷城",
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("项目状态与 outbox 原子性", () => {
  it("生产端口适配在同一 SQLite 事务提交状态和领域事件", () => {
    const fixture = createFixture();

    try {
      const result = fixture.application.createProject(createInput(), {
        correlationId: "request-project-create",
      });

      expect(result).toMatchObject({
        ok: true,
        value: { version: 1 },
      });
      expect(
        fixture.platformOutbox.getByEventId("event-project-created"),
      ).toMatchObject({
        envelope: {
          aggregate: {
            aggregateType: "project",
            module: "projects",
            version: 1,
          },
          eventName: "projects.project.created.v1",
        },
        status: "pending",
      });
    } finally {
      fixture.connection.close();
    }
  });

  it("outbox 写入失败时回滚项目状态且不留下事件", () => {
    const fixture = createFixture({
      enqueue() {
        throw new Error("injected outbox failure");
      },
    });

    try {
      const result = fixture.application.createProject(createInput(), {
        correlationId: "request-project-rollback",
      });

      expect(result).toMatchObject({
        error: {
          causeId: "cause-project-test",
          code: "projects.internal",
          kind: "internal",
        },
        ok: false,
      });
      expect(
        fixture.repository.findById(
          "018f47a2-9000-7f11-8d24-4a1cc5e6d720",
        ),
      ).toBeUndefined();
      expect(
        fixture.connection.client
          .prepare("SELECT count(*) AS total FROM domain_events")
          .get(),
      ).toEqual({ total: 0 });
      expect(
        fixture.connection.client
          .prepare(
            "SELECT version FROM project_catalog_state WHERE id = 1",
          )
          .get(),
      ).toEqual({ version: 0 });
    } finally {
      fixture.connection.close();
    }
  });
});
