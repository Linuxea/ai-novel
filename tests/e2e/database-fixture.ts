import { randomUUID } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { expect, test as base } from "@playwright/test";

const RESET_TABLES = [
  "project_model_preferences",
  "projects",
  "domain_events",
  "job_events",
  "jobs",
] as const;

function requireSafeE2eDatabase(filePath: string): string {
  const resolvedPath = resolve(filePath);
  const dataDir = dirname(resolvedPath);
  if (
    dirname(dataDir) !== resolve(tmpdir()) ||
    !basename(dataDir).startsWith("ai-novel-e2e-") ||
    basename(resolvedPath) !== "ai-novel.sqlite"
  ) {
    throw new Error("拒绝重置非 E2E 临时数据库");
  }
  return resolvedPath;
}

interface LockOptions {
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
}

interface LockOwner {
  readonly pid: number;
  readonly token: string;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function readLockOwner(lockPath: string): LockOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<
      LockOwner
    >;
    return typeof value.pid === "number" &&
      typeof value.token === "string"
      ? { pid: value.pid, token: value.token }
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

export async function acquireE2eDatabaseLock(
  filePath: string,
  options: LockOptions = {},
): Promise<() => void> {
  const safePath = requireSafeE2eDatabase(filePath);
  const lockPath = join(dirname(safePath), ".e2e-test.lock");
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();

  while (Date.now() < deadline) {
    try {
      const descriptor = openSync(lockPath, "wx");
      try {
        writeFileSync(
          descriptor,
          JSON.stringify({ pid: process.pid, token }),
        );
      } finally {
        closeSync(descriptor);
      }
      return () => {
        const owner = readLockOwner(lockPath);
        if (owner?.token === token) {
          rmSync(lockPath, { force: true });
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      const owner = readLockOwner(lockPath);
      if (owner && !isRunning(owner.pid)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, pollIntervalMs),
      );
    }
  }
  throw new Error("等待 E2E 数据库排他锁超时");
}

export function resetE2eDatabase(filePath: string): void {
  const database = new DatabaseSync(requireSafeE2eDatabase(filePath));
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const table of RESET_TABLES) {
      database.prepare(`DELETE FROM ${table}`).run();
    }
    database
      .prepare(
        "DELETE FROM sqlite_sequence WHERE name = 'job_events'",
      )
      .run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

interface E2eFixtures {
  readonly databaseReset: void;
}

const test = base.extend<E2eFixtures>({
  databaseReset: [
    async ({}, runTest) => {
      const filePath = process.env.DATABASE_PATH;
      if (!filePath) {
        throw new Error("E2E 缺少 DATABASE_PATH");
      }
      const release = await acquireE2eDatabaseLock(filePath);
      try {
        resetE2eDatabase(filePath);
        await runTest();
      } finally {
        release();
      }
    },
    { auto: true },
  ],
});

export { expect, test };
