import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = path.join(
  "/tmp/opencode",
  `ai-novel-transaction-test-${process.pid}-${Date.now()}`,
);

type Storage = typeof import("@/lib/storage");
type Transaction = typeof import("@/lib/storage/transaction");
type Paths = typeof import("@/lib/storage/paths");

let storage: Storage;
let transaction: Transaction;
let paths: Paths;

beforeAll(async () => {
  process.env.DATA_DIR = dataDir;
  storage = await import("@/lib/storage");
  transaction = await import("@/lib/storage/transaction");
  paths = await import("@/lib/storage/paths");
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function stageJournal(
  projectId: string,
  state: "active" | "committed",
  title: string,
): Promise<string> {
  const projectFile = path.join(storage.projectDir(projectId), "project.json");
  const before = await fs.readFile(projectFile);
  const txId = `recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const parent = paths.projectTransactionsDir(projectId);
  const activeDir = path.join(parent, `${txId}.active`);
  const backup = "before/0000.bin";
  await fs.mkdir(path.join(activeDir, "before"), { recursive: true });
  await fs.writeFile(path.join(activeDir, backup), before);
  await fs.writeFile(
    path.join(activeDir, "manifest.json"),
    JSON.stringify({
      version: 1,
      projectId,
      txId,
      startedAt: new Date().toISOString(),
      entries: [
        {
          target: "project.json",
          before: {
            exists: true,
            backup,
            size: before.length,
            sha256: createHash("sha256").update(before).digest("hex"),
          },
        },
      ],
    }),
  );
  const mutated = {
    ...(JSON.parse(before.toString("utf-8")) as Record<string, unknown>),
    title,
  };
  await fs.writeFile(projectFile, JSON.stringify(mutated, null, 2));
  if (state === "committed") {
    const committedDir = activeDir.replace(/\.active$/, ".committed");
    await fs.rename(activeDir, committedDir);
    return committedDir;
  }
  return activeDir;
}

describe("durable project transactions", () => {
  it("rolls back overwritten, created, and deleted files on failure", async () => {
    const project = await storage.createProject({ title: "事务前" });
    const chapter = await storage.createChapter(project.id, { title: "第一章" });
    await storage.writeChapterContent(project.id, chapter.id, "原始正文", 0);
    const before = await storage.getProject(project.id);
    const extraFile = path.join(storage.projectDir(project.id), "chapters/extra.md");

    await expect(
      storage.withProjectTransaction(project.id, async () => {
        await storage.updateProject(project.id, { title: "事务中" });
        await storage.writeProjectFiles(project.id, [
          { path: "chapters/extra.md", content: "临时正文" },
        ]);
        await storage.deleteChapter(project.id, chapter.id);
        throw new Error("inject failure");
      }),
    ).rejects.toThrow("inject failure");

    expect(await storage.getProject(project.id)).toEqual(before);
    expect((await storage.listChapters(project.id)).map((item) => item.id)).toEqual([
      chapter.id,
    ]);
    expect(await storage.readChapterContent(project.id, chapter.id)).toBe(
      "原始正文",
    );
    expect(await exists(extraFile)).toBe(false);
  });

  it("rolls back an active journal before serving project reads", async () => {
    const project = await storage.createProject({ title: "崩溃前" });
    const activeDir = await stageJournal(project.id, "active", "未提交");
    transaction.clearRecoveredProjectForTests(project.id);

    const recovered = await storage.getProject(project.id);

    expect(recovered?.title).toBe("崩溃前");
    expect(await exists(activeDir)).toBe(false);
  });

  it("cleans an active directory created before its manifest", async () => {
    const project = await storage.createProject({ title: "未开始事务" });
    const activeDir = path.join(
      paths.projectTransactionsDir(project.id),
      "uninitialized.active",
    );
    await fs.mkdir(path.join(activeDir, "before"), { recursive: true });
    transaction.clearRecoveredProjectForTests(project.id);

    const recovered = await storage.getProject(project.id);

    expect(recovered?.title).toBe("未开始事务");
    expect(await exists(activeDir)).toBe(false);
  });

  it("keeps committed data and only cleans its journal", async () => {
    const project = await storage.createProject({ title: "提交前" });
    const committedDir = await stageJournal(project.id, "committed", "已提交");
    transaction.clearRecoveredProjectForTests(project.id);

    const recovered = await storage.getProject(project.id);

    expect(recovered?.title).toBe("已提交");
    expect(await exists(committedDir)).toBe(false);
  });
});
