import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import { projectDir, projectTransactionsDir } from "@/lib/storage/paths";
import {
  atomicReplaceRaw,
  deleteFileRaw,
  ensureDir,
  fileExists,
  fsyncDir,
  isNotFoundError,
} from "@/lib/storage/raw-file";

const JournalEntrySchema = z.object({
  target: z.string().min(1),
  before: z.discriminatedUnion("exists", [
    z.object({ exists: z.literal(false) }),
    z.object({
      exists: z.literal(true),
      backup: z.string().min(1),
      size: z.number().int().nonnegative(),
      sha256: z.string().length(64),
    }),
  ]),
});

const JournalManifestSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  txId: z.string(),
  startedAt: z.string(),
  entries: z.array(JournalEntrySchema),
});

type JournalManifest = z.infer<typeof JournalManifestSchema>;

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function resolveInside(base: string, relativePath: string): string {
  const resolved = path.resolve(base, relativePath);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`事务路径非法: ${JSON.stringify(relativePath)}`);
  }
  return resolved;
}

class ProjectTransaction {
  readonly txId = nanoid(16);
  readonly parentDir: string;
  readonly activeDir: string;
  readonly committedDir: string;
  readonly rolledBackDir: string;
  readonly manifestPath: string;
  readonly beforeDir: string;
  readonly projectPath: string;
  manifest: JournalManifest;
  readonly seen = new Set<string>();
  started = false;

  constructor(readonly projectId: string) {
    this.parentDir = projectTransactionsDir(projectId);
    this.activeDir = path.join(this.parentDir, `${this.txId}.active`);
    this.committedDir = path.join(this.parentDir, `${this.txId}.committed`);
    this.rolledBackDir = path.join(this.parentDir, `${this.txId}.rolledback`);
    this.manifestPath = path.join(this.activeDir, "manifest.json");
    this.beforeDir = path.join(this.activeDir, "before");
    this.projectPath = projectDir(projectId);
    this.manifest = {
      version: 1,
      projectId,
      txId: this.txId,
      startedAt: new Date().toISOString(),
      entries: [],
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    await ensureDir(this.beforeDir);
    await atomicReplaceRaw(
      this.manifestPath,
      JSON.stringify(this.manifest, null, 2),
    );
    await fsyncDir(this.parentDir);
    this.started = true;
  }

  async capture(filePath: string): Promise<void> {
    const relativeTarget = path.relative(this.projectPath, filePath);
    resolveInside(this.projectPath, relativeTarget);
    if (this.seen.has(relativeTarget)) return;
    await this.start();

    const index = this.manifest.entries.length;
    let before: JournalManifest["entries"][number]["before"];
    try {
      const content = await fs.readFile(filePath);
      const backup = `before/${String(index).padStart(4, "0")}.bin`;
      await atomicReplaceRaw(path.join(this.activeDir, backup), content);
      before = {
        exists: true,
        backup,
        size: content.length,
        sha256: sha256(content),
      };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      before = { exists: false };
    }

    this.manifest = {
      ...this.manifest,
      entries: [...this.manifest.entries, { target: relativeTarget, before }],
    };
    await atomicReplaceRaw(
      this.manifestPath,
      JSON.stringify(this.manifest, null, 2),
    );
    this.seen.add(relativeTarget);
  }
}

const projectLocks = new Map<string, Promise<void>>();
const lockContext = new AsyncLocalStorage<ReadonlySet<string>>();
const transactionContext = new AsyncLocalStorage<ProjectTransaction>();
const recoveredProjects = new Set<string>();

async function readManifest(activeDir: string): Promise<JournalManifest> {
  const raw = await fs.readFile(path.join(activeDir, "manifest.json"), "utf-8");
  return JournalManifestSchema.parse(JSON.parse(raw) as unknown);
}

async function rollbackDirectory(
  projectId: string,
  activeDir: string,
): Promise<void> {
  const manifest = await readManifest(activeDir);
  if (manifest.projectId !== projectId) {
    throw new Error("事务 journal 的 projectId 不匹配");
  }
  const projectPath = projectDir(projectId);
  for (const entry of [...manifest.entries].reverse()) {
    const target = resolveInside(projectPath, entry.target);
    if (!entry.before.exists) {
      await deleteFileRaw(target);
      continue;
    }
    const backup = resolveInside(activeDir, entry.before.backup);
    const content = await fs.readFile(backup);
    if (
      content.length !== entry.before.size ||
      sha256(content) !== entry.before.sha256
    ) {
      throw new Error(`事务备份校验失败: ${entry.target}`);
    }
    await atomicReplaceRaw(target, content);
  }
}

async function cleanupDirectory(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fsyncDir(path.dirname(dir));
}

export async function recoverProjectTransactions(
  projectId: string,
  force = false,
): Promise<void> {
  if (!force && recoveredProjects.has(projectId)) return;
  const parent = projectTransactionsDir(projectId);
  let entries: string[];
  try {
    entries = await fs.readdir(parent);
  } catch (error) {
    if (isNotFoundError(error)) {
      recoveredProjects.add(projectId);
      return;
    }
    throw error;
  }

  const active = entries.filter((entry) => entry.endsWith(".active"));
  if (active.length > 1) {
    throw new Error("同一项目存在多个未完成事务，拒绝自动恢复");
  }
  for (const entry of entries.filter(
    (name) => name.endsWith(".committed") || name.endsWith(".rolledback"),
  )) {
    await cleanupDirectory(path.join(parent, entry));
  }
  if (active[0]) {
    const activeDir = path.join(parent, active[0]);
    if (!(await fileExists(path.join(activeDir, "manifest.json")))) {
      await cleanupDirectory(activeDir);
      recoveredProjects.add(projectId);
      return;
    }
    await rollbackDirectory(projectId, activeDir);
    const rolledBack = activeDir.replace(/\.active$/, ".rolledback");
    await fs.rename(activeDir, rolledBack);
    await fsyncDir(parent);
    await cleanupDirectory(rolledBack);
  }
  recoveredProjects.add(projectId);
}

export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const held = lockContext.getStore();
  if (held?.has(projectId)) return fn();

  const prev = projectLocks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => current);
  projectLocks.set(projectId, tail);
  await prev;
  try {
    return await lockContext.run(new Set(held).add(projectId), async () => {
      await recoverProjectTransactions(projectId);
      return fn();
    });
  } finally {
    release();
    if (projectLocks.get(projectId) === tail) projectLocks.delete(projectId);
  }
}

export function captureBeforeMutation(filePath: string): Promise<void> {
  const transaction = transactionContext.getStore();
  return transaction ? transaction.capture(filePath) : Promise.resolve();
}

export function withProjectTransaction<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withProjectLock(projectId, async () => {
    const outer = transactionContext.getStore();
    if (outer?.projectId === projectId) return fn();
    if (outer) throw new Error("不支持跨项目嵌套事务");

    const transaction = new ProjectTransaction(projectId);
    return transactionContext.run(transaction, async () => {
      try {
        const result = await fn();
        if (transaction.started) {
          await fs.rename(transaction.activeDir, transaction.committedDir);
          await fsyncDir(transaction.parentDir);
          await cleanupDirectory(transaction.committedDir).catch(() => {
            recoveredProjects.delete(projectId);
          });
        }
        return result;
      } catch (error) {
        if (transaction.started && (await fileExists(transaction.activeDir))) {
          try {
            await rollbackDirectory(projectId, transaction.activeDir);
            await fs.rename(transaction.activeDir, transaction.rolledBackDir);
            await fsyncDir(transaction.parentDir);
            await cleanupDirectory(transaction.rolledBackDir).catch(() => {
              recoveredProjects.delete(projectId);
            });
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "项目事务失败且回滚未完成",
            );
          }
        }
        throw error;
      }
    });
  });
}

export function clearRecoveredProjectForTests(projectId: string): void {
  recoveredProjects.delete(projectId);
}
