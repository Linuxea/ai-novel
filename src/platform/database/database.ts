import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate as migrateDatabase } from "drizzle-orm/node-sqlite/migrator";
import {
  pathsReferToSameLocation,
  resolvePathOutsideLegacyProjects,
} from "./path-safety";
import { withMigrationLock } from "./migration-lock";

const DEFAULT_DATABASE_PATH = "data/ai-novel.sqlite";
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

const openDatabasePaths = new Map<string, number>();
const DATABASE_SIDECAR_SUFFIXES = [
  "-wal",
  "-shm",
  "-journal",
] as const;

function createDrizzleDatabase(client: DatabaseSync) {
  return drizzle({ client });
}

export type PlatformDatabase = ReturnType<typeof createDrizzleDatabase>;

export interface DatabasePathOptions {
  readonly cwd?: string;
  readonly filePath?: string;
}

export interface CreateSqliteDatabaseOptions extends DatabasePathOptions {
  readonly busyTimeoutMs?: number;
  readonly migrate?: boolean;
  readonly migrationLockStaleAfterMs?: number;
  readonly migrationLockTimeoutMs?: number;
  readonly migrationsFolder?: string;
}

export interface UnitOfWorkContext {
  readonly client: DatabaseSync;
  readonly database: PlatformDatabase;
}

export interface SqliteUnitOfWork {
  run<TResult>(
    work: (
      context: UnitOfWorkContext,
    ) => TResult extends PromiseLike<unknown> ? never : TResult,
  ): TResult;
}

export interface SqliteDatabaseConnection {
  readonly client: DatabaseSync;
  readonly database: PlatformDatabase;
  readonly filePath: string;
  readonly rootDirectory: string;
  readonly unitOfWork: SqliteUnitOfWork;
  close(): void;
  isOpen(): boolean;
}

export interface DatabaseIntegrityResult {
  readonly messages: readonly string[];
  readonly ok: boolean;
}

export interface DatabaseBackupResult {
  readonly pages: number;
  readonly path: string;
}

export interface RestoreDatabaseOptions {
  readonly backupPath: string;
  readonly cwd?: string;
  readonly destinationPath: string;
  readonly fileOperations?: DatabaseFileOperations;
}

export interface DatabaseMaintenancePathOptions {
  readonly cwd?: string;
}

export interface DatabaseFileOperations {
  remove?(filePath: string): void;
  rename(sourcePath: string, destinationPath: string): void;
}

export class DatabaseRestoreRollbackError extends Error {
  readonly recoveryPaths: readonly string[];

  constructor(
    cause: unknown,
    recoveryPaths: readonly string[],
    rollbackFailures: readonly string[],
  ) {
    super(
      `SQLite 恢复失败且自动回滚不完整；请从以下 quarantine 路径人工恢复: ${recoveryPaths.join(", ")}；回滚错误: ${rollbackFailures.join("; ")}`,
      { cause },
    );
    this.name = "DatabaseRestoreRollbackError";
    this.recoveryPaths = recoveryPaths;
  }
}

export class DatabaseCleanupError extends Error {
  readonly databaseInstalled = true;
  readonly residualPaths: readonly string[];

  constructor(
    residualPaths: readonly string[],
    cleanupFailures: readonly string[],
  ) {
    super(
      `SQLite 新库已成功安装，但 cleanup 未完成；保留路径: ${residualPaths.join(", ")}；清理错误: ${cleanupFailures.join("; ")}`,
    );
    this.name = "DatabaseCleanupError";
    this.residualPaths = residualPaths;
  }
}

function requireBusyTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("SQLite busy timeout 必须是非负安全整数");
  }
  return value;
}

function registerOpenPath(filePath: string): void {
  openDatabasePaths.set(filePath, (openDatabasePaths.get(filePath) ?? 0) + 1);
}

function unregisterOpenPath(filePath: string): void {
  const count = openDatabasePaths.get(filePath);
  if (count === undefined || count <= 1) {
    openDatabasePaths.delete(filePath);
    return;
  }
  openDatabasePaths.set(filePath, count - 1);
}

function isManagedDatabaseOpen(
  filePath: string,
  cwd: string,
): boolean {
  return [...openDatabasePaths.keys()].some((openPath) =>
    pathsReferToSameLocation(filePath, openPath, { cwd }),
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeDatabaseFile(filePath: string): void {
  const client = new DatabaseSync(filePath, {
    enableForeignKeyConstraints: true,
  });
  try {
    const messages = client
      .prepare("PRAGMA integrity_check")
      .all()
      .map((row) => String(row.integrity_check));
    if (messages.length !== 1 || messages[0] !== "ok") {
      throw new Error(
        `SQLite stage 完整性检查失败: ${messages.join("; ")}`,
      );
    }
    client.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE",
    );
  } finally {
    client.close();
  }
}

async function replaceClosedDatabase(
  stagedPath: string,
  destinationPath: string,
  cwd: string,
  fileOperations: DatabaseFileOperations = {
    rename: renameSync,
  },
): Promise<void> {
  normalizeDatabaseFile(stagedPath);
  const remove = (filePath: string): void => {
    if (fileOperations.remove) {
      fileOperations.remove(filePath);
      return;
    }
    rmSync(filePath, { force: true });
  };
  const quarantineId = randomUUID();
  const artifacts = [
    destinationPath,
    ...DATABASE_SIDECAR_SUFFIXES.map(
      (suffix) => `${destinationPath}${suffix}`,
    ),
  ];
  const isolated = new Map<string, string>();
  let installed = false;

  try {
    for (const artifact of artifacts) {
      resolvePathOutsideLegacyProjects(artifact, {
        cwd,
        label: "SQLite 旧目标文件",
      });
      if (!existsSync(artifact)) {
        continue;
      }
      const quarantinePath = `${artifact}.quarantine-${quarantineId}`;
      resolvePathOutsideLegacyProjects(quarantinePath, {
        cwd,
        label: "SQLite quarantine",
      });
      fileOperations.rename(artifact, quarantinePath);
      isolated.set(artifact, quarantinePath);
    }
    fileOperations.rename(stagedPath, destinationPath);
    installed = true;
    const finalIntegrity = await assertDatabaseIntegrity(
      destinationPath,
      { cwd },
    );
    if (!finalIntegrity.ok) {
      throw new Error(
        `SQLite 最终完整性检查失败: ${finalIntegrity.messages.join("; ")}`,
      );
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    if (installed) {
      for (const artifact of artifacts) {
        if (!existsSync(artifact)) {
          continue;
        }
        try {
          remove(artifact);
        } catch (rollbackError) {
          rollbackFailures.push(
            `${artifact}: ${String(rollbackError)}`,
          );
        }
      }
    }
    for (const [artifact, quarantinePath] of [
      ...isolated.entries(),
    ].reverse()) {
      if (existsSync(artifact)) {
        rollbackFailures.push(
          `${artifact}: 目标仍存在，未覆盖 quarantine`,
        );
        continue;
      }
      if (existsSync(quarantinePath)) {
        try {
          fileOperations.rename(quarantinePath, artifact);
        } catch (rollbackError) {
          rollbackFailures.push(
            `${quarantinePath} -> ${artifact}: ${String(rollbackError)}`,
          );
        }
      }
    }
    const recoveryPaths = [...isolated.values()].filter((path) =>
      existsSync(path),
    );
    if (rollbackFailures.length > 0) {
      throw new DatabaseRestoreRollbackError(
        error,
        recoveryPaths,
        rollbackFailures,
      );
    }
    throw error;
  }

  const cleanupFailures: string[] = [];
  const cleanupPaths = [
    ...DATABASE_SIDECAR_SUFFIXES.map(
      (suffix) => `${destinationPath}${suffix}`,
    ),
    ...isolated.values(),
  ];
  for (const cleanupPath of cleanupPaths) {
    if (!existsSync(cleanupPath)) {
      continue;
    }
    try {
      remove(cleanupPath);
    } catch (cleanupError) {
      cleanupFailures.push(
        `${cleanupPath}: ${String(cleanupError)}`,
      );
    }
  }
  if (cleanupFailures.length > 0) {
    throw new DatabaseCleanupError(
      cleanupPaths.filter((path) => existsSync(path)),
      cleanupFailures,
    );
  }
}

export function resolveDatabasePath(
  options: DatabasePathOptions = {},
): string {
  const configuredPath =
    options.filePath?.trim() ||
    process.env.DATABASE_PATH?.trim() ||
    DEFAULT_DATABASE_PATH;
  return resolvePathOutsideLegacyProjects(configuredPath, {
    allowMemory: true,
    cwd: options.cwd,
    label: "SQLite 数据库",
  });
}

export function createSqliteDatabase(
  options: CreateSqliteDatabaseOptions = {},
): SqliteDatabaseConnection {
  const filePath = resolveDatabasePath(options);
  const rootDirectory = resolve(
    /*turbopackIgnore: true*/ options.cwd ?? process.cwd(),
  );
  const busyTimeoutMs = requireBusyTimeout(
    options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
  );
  const migrationsFolder =
    options.migrate === false
      ? undefined
      : resolvePathOutsideLegacyProjects(
          options.migrationsFolder ?? "drizzle",
          {
            cwd: rootDirectory,
            label: "SQLite 迁移目录",
          },
        );
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const client = new DatabaseSync(filePath, {
    enableForeignKeyConstraints: true,
    timeout: busyTimeoutMs,
  });
  let open = true;

  try {
    client.exec("PRAGMA foreign_keys = ON");
    client.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    client.exec("PRAGMA journal_mode = WAL");

    const database = createDrizzleDatabase(client);
    if (migrationsFolder) {
      withMigrationLock(filePath, () => {
        migrateDatabase(database, {
          migrationsFolder,
        });
      }, {
        staleAfterMs: options.migrationLockStaleAfterMs,
        timeoutMs: options.migrationLockTimeoutMs,
      });
    }
    if (filePath !== ":memory:") {
      registerOpenPath(filePath);
    }

    const unitOfWork: SqliteUnitOfWork = {
      run<TResult>(
        work: (
          context: UnitOfWorkContext,
        ) => TResult extends PromiseLike<unknown> ? never : TResult,
      ): TResult {
        if (!open) {
          throw new Error("SQLite 数据库已关闭");
        }
        if (client.isTransaction) {
          throw new Error("Unit of Work 不允许嵌套事务");
        }

        client.exec("BEGIN IMMEDIATE");
        try {
          const result = work({ client, database });
          if (isPromiseLike(result)) {
            throw new Error("Unit of Work 回调必须同步，禁止异步慢操作");
          }
          client.exec("COMMIT");
          return result;
        } catch (error) {
          if (client.isTransaction) {
            client.exec("ROLLBACK");
          }
          throw error;
        }
      },
    };

    return {
      client,
      database,
      filePath,
      rootDirectory,
      unitOfWork,
      close() {
        if (!open) {
          return;
        }
        client.close();
        open = false;
        if (filePath !== ":memory:") {
          unregisterOpenPath(filePath);
        }
      },
      isOpen() {
        return open;
      },
    };
  } catch (error) {
    if (open) {
      client.close();
      open = false;
    }
    throw error;
  }
}

export async function assertDatabaseIntegrity(
  target: string | SqliteDatabaseConnection,
  options: DatabaseMaintenancePathOptions = {},
): Promise<DatabaseIntegrityResult> {
  const ownsConnection = typeof target === "string";
  const filePath = resolvePathOutsideLegacyProjects(
    ownsConnection ? target : target.filePath,
    {
      allowMemory: true,
      cwd: options.cwd ?? (ownsConnection ? undefined : target.rootDirectory),
      label: "完整性检查源",
    },
  );
  const client = ownsConnection
    ? new DatabaseSync(filePath, {
        readOnly: true,
        enableForeignKeyConstraints: true,
      })
    : target.client;

  try {
    const rows = client.prepare("PRAGMA integrity_check").all();
    const messages = rows.map((row) => String(row.integrity_check));
    return {
      messages,
      ok: messages.length === 1 && messages[0] === "ok",
    };
  } finally {
    if (ownsConnection) {
      client.close();
    }
  }
}

export async function backupDatabase(
  source: SqliteDatabaseConnection,
  destinationPath: string,
  options: DatabaseMaintenancePathOptions = {},
): Promise<DatabaseBackupResult> {
  const cwd = resolve(
    /*turbopackIgnore: true*/ options.cwd ??
      source.rootDirectory,
  );
  const sourcePath = resolvePathOutsideLegacyProjects(
    source.filePath,
    {
      allowMemory: true,
      cwd,
      label: "备份源",
    },
  );
  const destination = resolvePathOutsideLegacyProjects(
    destinationPath,
    {
      cwd,
      label: "备份目标",
    },
  );
  if (!source.isOpen()) {
    throw new Error("无法备份已关闭的数据库");
  }
  if (
    sourcePath !== ":memory:" &&
    pathsReferToSameLocation(sourcePath, destination, { cwd })
  ) {
    throw new Error("备份目标不能覆盖源数据库");
  }
  if (isManagedDatabaseOpen(destination, cwd)) {
    throw new Error("备份目标是打开中的数据库");
  }

  mkdirSync(dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.backup-${randomUUID()}.tmp`;

  try {
    source.client.exec("PRAGMA wal_checkpoint(FULL)");
    const pages = await backup(source.client, temporaryPath);
    const integrity = await assertDatabaseIntegrity(temporaryPath);
    if (!integrity.ok) {
      throw new Error(`SQLite 备份完整性检查失败: ${integrity.messages.join("; ")}`);
    }
    await replaceClosedDatabase(
      temporaryPath,
      destination,
      cwd,
    );
    return { pages, path: destination };
  } finally {
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath, { force: true });
    }
  }
}

export async function restoreDatabase(
  options: RestoreDatabaseOptions,
): Promise<void> {
  const cwd = resolve(
    /*turbopackIgnore: true*/ options.cwd ?? process.cwd(),
  );
  const backupPath = resolvePathOutsideLegacyProjects(
    options.backupPath,
    {
      cwd,
      label: "恢复源",
    },
  );
  const destinationPath = resolvePathOutsideLegacyProjects(
    options.destinationPath,
    {
      cwd,
      label: "恢复目标",
    },
  );
  if (isManagedDatabaseOpen(destinationPath, cwd)) {
    throw new Error("恢复不得覆盖打开中的数据库");
  }
  if (
    pathsReferToSameLocation(backupPath, destinationPath, {
      cwd,
    })
  ) {
    throw new Error("恢复源与目标数据库不能相同");
  }

  const source = new DatabaseSync(backupPath, {
    readOnly: true,
    enableForeignKeyConstraints: true,
  });
  mkdirSync(dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.restore-${randomUUID()}.tmp`;

  try {
    source.exec(
      `VACUUM INTO ${sqlString(temporaryPath)}`,
    );
    const integrity = await assertDatabaseIntegrity(temporaryPath);
    if (!integrity.ok) {
      throw new Error(`SQLite 恢复完整性检查失败: ${integrity.messages.join("; ")}`);
    }
    await replaceClosedDatabase(
      temporaryPath,
      destinationPath,
      cwd,
      options.fileOperations,
    );
  } finally {
    source.close();
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath, { force: true });
    }
  }
}
