import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  acquireE2eDatabaseLock,
  resetE2eDatabase,
} from "../e2e/database-fixture";

describe("E2E 数据库重置", () => {
  it("仅清理 E2E 临时库中的业务、outbox 与 job 状态", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ai-novel-e2e-"));
    const filePath = join(dataDir, "ai-novel.sqlite");
    const database = new DatabaseSync(filePath);
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (id TEXT PRIMARY KEY);
      CREATE TABLE project_model_preferences (
        project_id TEXT,
        role TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      CREATE TABLE domain_events (id TEXT PRIMARY KEY);
      CREATE TABLE jobs (id TEXT PRIMARY KEY);
      CREATE TABLE job_events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );
      INSERT INTO projects VALUES ('project-1');
      INSERT INTO project_model_preferences VALUES ('project-1', 'chat');
      INSERT INTO domain_events VALUES ('event-1');
      INSERT INTO jobs VALUES ('job-1');
      INSERT INTO job_events (job_id) VALUES ('job-1');
    `);
    database.close();

    resetE2eDatabase(filePath);

    const verified = new DatabaseSync(filePath);
    try {
      for (const table of [
        "project_model_preferences",
        "projects",
        "domain_events",
        "job_events",
        "jobs",
      ]) {
        expect(
          verified
            .prepare(`SELECT count(*) AS total FROM ${table}`)
            .get(),
        ).toEqual({ total: 0 });
      }
    } finally {
      verified.close();
      rmSync(dataDir, { force: true, recursive: true });
    }
  });

  it("拒绝清理非 E2E 临时数据库", () => {
    expect(() =>
      resetE2eDatabase(join(tmpdir(), "production.sqlite")),
    ).toThrow("拒绝重置非 E2E 临时数据库");
  });

  it("跨 worker 排他锁从 reset 前持有到整个 test 结束", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ai-novel-e2e-"));
    const filePath = join(dataDir, "ai-novel.sqlite");
    const firstRelease = await acquireE2eDatabaseLock(filePath, {
      pollIntervalMs: 5,
      timeoutMs: 1_000,
    });
    let secondAcquired = false;
    const secondLock = acquireE2eDatabaseLock(filePath, {
      pollIntervalMs: 5,
      timeoutMs: 1_000,
    }).then((release) => {
      secondAcquired = true;
      return release;
    });

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    expect(secondAcquired).toBe(false);
    firstRelease();

    const secondRelease = await secondLock;
    expect(secondAcquired).toBe(true);
    secondRelease();
    rmSync(dataDir, { force: true, recursive: true });
  });

  it("所有 E2E spec 统一使用持锁 fixture", () => {
    const e2eDirectory = join(process.cwd(), "tests", "e2e");
    const specs = readdirSync(e2eDirectory).filter((name) =>
      name.endsWith(".spec.ts"),
    );

    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(
        readFileSync(join(e2eDirectory, spec), "utf8"),
      ).toContain('from "./database-fixture"');
    }
  });
});
