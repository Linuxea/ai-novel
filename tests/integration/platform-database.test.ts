import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDatabaseIntegrity,
  backupDatabase,
  closeDatabaseSingleton,
  createSqliteDatabase,
  DatabaseCleanupError,
  DatabaseRestoreRollbackError,
  getDatabaseSingleton,
  resolveDatabasePath,
  restoreDatabase,
} from "@/platform/database";

const temporaryDirectories: string[] = [];
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "ai-novel-platform-db-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createWalCrashImage(
  destinationPath: string,
  backupPath: string,
): void {
  mkdirSync(dirname(destinationPath), { recursive: true });
  mkdirSync(dirname(backupPath), { recursive: true });
  const client = new DatabaseSync(destinationPath);
  const savedMain = `${destinationPath}.saved-main`;
  const savedWal = `${destinationPath}.saved-wal`;
  const savedShm = `${destinationPath}.saved-shm`;
  try {
    client.exec(
      "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE restore_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO restore_probe VALUES ('probe', 'backup'); PRAGMA wal_checkpoint(TRUNCATE)",
    );
    client.exec(
      `VACUUM INTO '${backupPath.replaceAll("'", "''")}'`,
    );
    client
      .prepare(
        "UPDATE restore_probe SET value = 'stale' WHERE id = 'probe'",
      )
      .run();
    copyFileSync(destinationPath, savedMain);
    copyFileSync(`${destinationPath}-wal`, savedWal);
    copyFileSync(`${destinationPath}-shm`, savedShm);
  } finally {
    client.close();
  }
  copyFileSync(savedMain, destinationPath);
  copyFileSync(savedWal, `${destinationPath}-wal`);
  copyFileSync(savedShm, `${destinationPath}-shm`);
  rmSync(savedMain);
  rmSync(savedWal);
  rmSync(savedShm);
}

afterEach(() => {
  closeDatabaseSingleton();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite 平台", () => {
  it("解析默认数据库路径且拒绝指向旧项目存储", () => {
    const cwd = createTemporaryDirectory();

    expect(resolveDatabasePath({ cwd })).toBe(
      resolve(cwd, "data/ai-novel.sqlite"),
    );
    expect(() =>
      resolveDatabasePath({
        cwd,
        filePath: "data/projects/legacy.sqlite",
      }),
    ).toThrow("旧 data/projects");
  });

  it("创建父目录并启用 WAL、外键与 busy timeout", () => {
    const directory = createTemporaryDirectory();
    const filePath = join(directory, "nested", "platform.sqlite");
    const connection = createSqliteDatabase({
      busyTimeoutMs: 4_321,
      filePath,
    });

    try {
      expect(existsSync(filePath)).toBe(true);
      expect(
        connection.client.prepare("PRAGMA journal_mode").get(),
      ).toEqual({ journal_mode: "wal" });
      expect(
        connection.client.prepare("PRAGMA foreign_keys").get(),
      ).toEqual({ foreign_keys: 1 });
      expect(
        connection.client.prepare("PRAGMA busy_timeout").get(),
      ).toEqual({ timeout: 4_321 });
    } finally {
      connection.close();
    }
  });

  it("从真实 SQL 迁移创建首批平台表", () => {
    const directory = createTemporaryDirectory();
    const connection = createSqliteDatabase({
      filePath: join(directory, "migrated.sqlite"),
    });

    try {
      const tableNames = connection.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name);

      expect(tableNames).toEqual(
        expect.arrayContaining([
          "__drizzle_migrations",
          "domain_events",
          "job_events",
          "jobs",
        ]),
      );
    } finally {
      connection.close();
    }
  });

  it("在一个同步 Unit of Work 中提交全部写入", () => {
    const directory = createTemporaryDirectory();
    const connection = createSqliteDatabase({
      filePath: join(directory, "commit.sqlite"),
    });

    try {
      connection.client.exec(
        "CREATE TABLE business_state (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );

      const result = connection.unitOfWork.run(({ client }) => {
        client
          .prepare("INSERT INTO business_state (id, value) VALUES (?, ?)")
          .run("state-1", "committed");
        client
          .prepare(
            "INSERT INTO domain_events (id, event_id, event_name, envelope_json, status, attempts, max_attempts, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, 5, ?, ?, ?)",
          )
          .run(
            "outbox-1",
            "event-1",
            "canon.character.created.v1",
            "{}",
            "2026-08-30T00:00:00.000Z",
            "2026-08-30T00:00:00.000Z",
            "2026-08-30T00:00:00.000Z",
          );
        return "committed";
      });

      expect(result).toBe("committed");
      expect(
        connection.client
          .prepare("SELECT value FROM business_state WHERE id = ?")
          .get("state-1"),
      ).toEqual({ value: "committed" });
      expect(
        connection.client
          .prepare("SELECT status FROM domain_events WHERE id = ?")
          .get("outbox-1"),
      ).toEqual({ status: "pending" });
    } finally {
      connection.close();
    }
  });

  it("异常或异步事务回调会可靠回滚", () => {
    const directory = createTemporaryDirectory();
    const connection = createSqliteDatabase({
      filePath: join(directory, "rollback.sqlite"),
    });

    try {
      connection.client.exec(
        "CREATE TABLE transaction_probe (value TEXT NOT NULL)",
      );

      expect(() =>
        connection.unitOfWork.run(({ client }) => {
          client
            .prepare("INSERT INTO transaction_probe (value) VALUES (?)")
            .run("rolled-back");
          throw new Error("rollback");
        }),
      ).toThrow("rollback");
      expect(
        connection.client
          .prepare("SELECT value FROM transaction_probe")
          .all(),
      ).toEqual([]);

      expect(() =>
        connection.unitOfWork.run(
          (() => Promise.resolve("slow")) as unknown as () => string,
        ),
      ).toThrow("同步");
      expect(connection.client.isTransaction).toBe(false);
    } finally {
      connection.close();
    }
  });

  it("受控单例可关闭并按同一路径复用", () => {
    const directory = createTemporaryDirectory();
    const filePath = join(directory, "singleton.sqlite");
    const first = getDatabaseSingleton({ filePath });
    const second = getDatabaseSingleton({ filePath });

    expect(second).toBe(first);
    closeDatabaseSingleton();
    expect(first.isOpen()).toBe(false);

    const reopened = getDatabaseSingleton({ filePath });
    expect(reopened).not.toBe(first);
    expect(reopened.isOpen()).toBe(true);
  });

  it("创建一致性备份并原子恢复到关闭的目标库", async () => {
    const directory = createTemporaryDirectory();
    const sourcePath = join(directory, "source.sqlite");
    const backupPath = join(directory, "backups", "source.sqlite");
    const restoredPath = join(directory, "restored.sqlite");
    const source = createSqliteDatabase({ filePath: sourcePath });

    try {
      source.client.exec(
        "CREATE TABLE backup_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      source.client
        .prepare("INSERT INTO backup_probe (id, value) VALUES (?, ?)")
        .run("probe-1", "safe");

      const backup = await backupDatabase(source, backupPath);
      expect(backup.path).toBe(resolve(backupPath));
      expect(backup.pages).toBeGreaterThan(0);
      expect(await assertDatabaseIntegrity(backup.path)).toEqual({
        ok: true,
        messages: ["ok"],
      });

      await restoreDatabase({
        backupPath: backup.path,
        destinationPath: restoredPath,
      });
      const restored = createSqliteDatabase({
        filePath: restoredPath,
        migrate: false,
      });
      try {
        expect(
          restored.client
            .prepare("SELECT value FROM backup_probe WHERE id = ?")
            .get("probe-1"),
        ).toEqual({ value: "safe" });
      } finally {
        restored.close();
      }
    } finally {
      source.close();
    }
  });

  it("恢复拒绝覆盖打开中的数据库且不留下半写文件", async () => {
    const directory = createTemporaryDirectory();
    const source = createSqliteDatabase({
      filePath: join(directory, "source.sqlite"),
    });
    const destination = createSqliteDatabase({
      filePath: join(directory, "destination.sqlite"),
    });
    const backupPath = join(directory, "backup.sqlite");

    try {
      await backupDatabase(source, backupPath);

      await expect(
        restoreDatabase({
          backupPath,
          destinationPath: destination.filePath,
        }),
      ).rejects.toThrow("打开中的数据库");
      expect(
        readdirSync(directory).filter((name) =>
          name.includes(".restore-"),
        ),
      ).toEqual([]);
    } finally {
      destination.close();
      source.close();
    }
  });

  it("恢复清除旧 WAL sidecar 并读取备份时刻的值", async () => {
    const directory = createTemporaryDirectory();
    const destinationPath = join(directory, "destination.sqlite");
    const backupPath = join(directory, "backup.sqlite");
    createWalCrashImage(destinationPath, backupPath);

    await restoreDatabase({ backupPath, destinationPath });

    for (const suffix of ["-wal", "-shm", "-journal"]) {
      expect(existsSync(`${destinationPath}${suffix}`)).toBe(false);
    }
    expect(await assertDatabaseIntegrity(destinationPath)).toEqual({
      messages: ["ok"],
      ok: true,
    });
    const restored = new DatabaseSync(destinationPath, {
      readOnly: true,
    });
    try {
      expect(
        restored
          .prepare(
            "SELECT value FROM restore_probe WHERE id = 'probe'",
          )
          .get(),
      ).toEqual({ value: "backup" });
    } finally {
      restored.close();
    }
  });

  it("恢复 stage 校验失败时不破坏现有数据库", async () => {
    const directory = createTemporaryDirectory();
    const destinationPath = join(directory, "destination.sqlite");
    const invalidBackupPath = join(directory, "invalid.sqlite");
    const destination = new DatabaseSync(destinationPath);
    destination.exec(
      "CREATE TABLE restore_probe (value TEXT NOT NULL); INSERT INTO restore_probe VALUES ('original')",
    );
    destination.close();
    writeFileSync(invalidBackupPath, "not sqlite");

    await expect(
      restoreDatabase({
        backupPath: invalidBackupPath,
        destinationPath,
      }),
    ).rejects.toThrow();

    const unchanged = new DatabaseSync(destinationPath, {
      readOnly: true,
    });
    try {
      expect(
        unchanged.prepare("SELECT value FROM restore_probe").get(),
      ).toEqual({ value: "original" });
    } finally {
      unchanged.close();
    }
  });

  it("有效备份可替换非 SQLite 目标及其不可信 sidecars", async () => {
    const directory = createTemporaryDirectory();
    const backupPath = join(directory, "backup.sqlite");
    const destinationPath = join(directory, "damaged.sqlite");
    const backup = new DatabaseSync(backupPath);
    backup.exec(
      "CREATE TABLE restore_probe (value TEXT NOT NULL); INSERT INTO restore_probe VALUES ('restored')",
    );
    backup.close();
    writeFileSync(destinationPath, "not sqlite");
    writeFileSync(`${destinationPath}-wal`, "bad wal");
    writeFileSync(`${destinationPath}-shm`, "bad shm");
    writeFileSync(`${destinationPath}-journal`, "bad journal");

    await restoreDatabase({ backupPath, destinationPath });

    const restored = new DatabaseSync(destinationPath, {
      readOnly: true,
    });
    try {
      expect(
        restored.prepare("SELECT value FROM restore_probe").get(),
      ).toEqual({ value: "restored" });
    } finally {
      restored.close();
    }
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      expect(existsSync(`${destinationPath}${suffix}`)).toBe(false);
    }
  });

  it("有效备份可替换带损坏 WAL 的目标库", async () => {
    const directory = createTemporaryDirectory();
    const backupPath = join(directory, "backup.sqlite");
    const destinationPath = join(directory, "damaged-wal.sqlite");
    const backup = new DatabaseSync(backupPath);
    backup.exec(
      "CREATE TABLE restore_probe (value TEXT NOT NULL); INSERT INTO restore_probe VALUES ('backup')",
    );
    backup.close();
    const destination = new DatabaseSync(destinationPath);
    destination.exec(
      "PRAGMA journal_mode = WAL; CREATE TABLE restore_probe (value TEXT NOT NULL); INSERT INTO restore_probe VALUES ('old')",
    );
    destination.close();
    writeFileSync(`${destinationPath}-wal`, "corrupted wal");
    writeFileSync(`${destinationPath}-shm`, "corrupted shm");

    await restoreDatabase({ backupPath, destinationPath });

    const restored = new DatabaseSync(destinationPath, {
      readOnly: true,
    });
    try {
      expect(
        restored.prepare("SELECT value FROM restore_probe").get(),
      ).toEqual({ value: "backup" });
    } finally {
      restored.close();
    }
  });

  it("stage 安装失败时完整回滚原主库与 sidecars", async () => {
    const directory = createTemporaryDirectory();
    const backupPath = join(directory, "backup.sqlite");
    const destinationPath = join(directory, "original.bin");
    const originalFiles = new Map<string, Buffer>();
    const backup = new DatabaseSync(backupPath);
    backup.exec("CREATE TABLE restore_probe (value TEXT NOT NULL)");
    backup.close();
    for (const [suffix, content] of [
      ["", "original-main"],
      ["-wal", "original-wal"],
      ["-shm", "original-shm"],
      ["-journal", "original-journal"],
    ] as const) {
      const filePath = `${destinationPath}${suffix}`;
      writeFileSync(filePath, content);
      originalFiles.set(filePath, readFileSync(filePath));
    }
    let installAttempts = 0;

    await expect(
      restoreDatabase({
        backupPath,
        destinationPath,
        fileOperations: {
          rename(sourcePath, targetPath) {
            if (
              sourcePath.includes(".restore-") &&
              targetPath === destinationPath
            ) {
              installAttempts += 1;
              throw new Error("injected install failure");
            }
            renameSync(sourcePath, targetPath);
          },
        },
      }),
    ).rejects.toThrow("injected install failure");

    expect(installAttempts).toBe(1);
    for (const [filePath, content] of originalFiles) {
      expect(readFileSync(filePath)).toEqual(content);
    }
  });

  it("stage 安装后最终校验失败时完整回滚原文件", async () => {
    const directory = createTemporaryDirectory();
    const backupPath = join(directory, "backup.sqlite");
    const destinationPath = join(directory, "original.sqlite");
    const backup = new DatabaseSync(backupPath);
    backup.exec("CREATE TABLE restore_probe (value TEXT NOT NULL)");
    backup.close();
    const original = new DatabaseSync(destinationPath);
    original.exec(
      "CREATE TABLE restore_probe (value TEXT NOT NULL); INSERT INTO restore_probe VALUES ('original')",
    );
    original.close();
    const originalMain = readFileSync(destinationPath);
    writeFileSync(`${destinationPath}-wal`, "original-wal");
    const originalWal = readFileSync(`${destinationPath}-wal`);

    await expect(
      restoreDatabase({
        backupPath,
        destinationPath,
        fileOperations: {
          rename(sourcePath, targetPath) {
            renameSync(sourcePath, targetPath);
            if (
              sourcePath.includes(".restore-") &&
              targetPath === destinationPath
            ) {
              writeFileSync(targetPath, "damaged installed stage");
            }
          },
        },
      }),
    ).rejects.toThrow();

    expect(readFileSync(destinationPath)).toEqual(originalMain);
    expect(readFileSync(`${destinationPath}-wal`)).toEqual(
      originalWal,
    );
  });

  it("rollback 二次 rename 失败时保留 quarantine 并报告人工恢复路径", async () => {
    const directory = createTemporaryDirectory();
    const backupPath = join(directory, "backup.sqlite");
    const destinationPath = join(directory, "original.sqlite");
    const backup = new DatabaseSync(backupPath);
    backup.exec("CREATE TABLE restore_probe (value TEXT NOT NULL)");
    backup.close();
    writeFileSync(destinationPath, "original-main");
    const originalMain = readFileSync(destinationPath);
    let thrown: unknown;

    try {
      await restoreDatabase({
        backupPath,
        destinationPath,
        fileOperations: {
          rename(sourcePath, targetPath) {
            if (
              sourcePath.includes(".restore-") &&
              targetPath === destinationPath
            ) {
              throw new Error("install failed");
            }
            if (
              sourcePath.includes(".quarantine-") &&
              targetPath === destinationPath
            ) {
              throw new Error("rollback rename failed");
            }
            renameSync(sourcePath, targetPath);
          },
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DatabaseRestoreRollbackError);
    const rollbackError = thrown as DatabaseRestoreRollbackError;
    expect(rollbackError.message).toContain("人工恢复");
    expect(rollbackError.recoveryPaths).toHaveLength(1);
    expect(readFileSync(rollbackError.recoveryPaths[0]!)).toEqual(
      originalMain,
    );
  });

  it("新库成功后 cleanup 失败不回滚新库并保留 quarantine", async () => {
    const directory = createTemporaryDirectory();
    const backupPath = join(directory, "backup.sqlite");
    const destinationPath = join(directory, "original.sqlite");
    const backup = new DatabaseSync(backupPath);
    backup.exec(
      "CREATE TABLE restore_probe (value TEXT NOT NULL); INSERT INTO restore_probe VALUES ('new')",
    );
    backup.close();
    const original = new DatabaseSync(destinationPath);
    original.exec(
      "CREATE TABLE restore_probe (value TEXT NOT NULL); INSERT INTO restore_probe VALUES ('old')",
    );
    original.close();
    const originalMain = readFileSync(destinationPath);
    let thrown: unknown;

    try {
      await restoreDatabase({
        backupPath,
        destinationPath,
        fileOperations: {
          remove(filePath) {
            if (filePath.includes(".quarantine-")) {
              throw new Error("cleanup failed");
            }
            rmSync(filePath, { force: true });
          },
          rename: renameSync,
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DatabaseCleanupError);
    const cleanupError = thrown as DatabaseCleanupError;
    expect(cleanupError.databaseInstalled).toBe(true);
    expect(cleanupError.residualPaths).toHaveLength(1);
    expect(readFileSync(cleanupError.residualPaths[0]!)).toEqual(
      originalMain,
    );
    const installed = new DatabaseSync(destinationPath, {
      readOnly: true,
    });
    try {
      expect(
        installed.prepare("SELECT value FROM restore_probe").get(),
      ).toEqual({ value: "new" });
    } finally {
      installed.close();
    }
  });

  it("所有维护 API 在文件操作前拒绝旧项目树及其 symlink 别名", async () => {
    const cwd = createTemporaryDirectory();
    const legacyDirectory = join(cwd, "data", "projects");
    const sentinelPath = join(legacyDirectory, "sentinel.txt");
    const symlinkPath = join(cwd, "legacy-alias");
    mkdirSync(legacyDirectory, { recursive: true });
    writeFileSync(sentinelPath, "unchanged");
    symlinkSync(legacyDirectory, symlinkPath, "dir");
    const initialEntries = readdirSync(legacyDirectory).sort();

    expect(() =>
      createSqliteDatabase({
        cwd,
        filePath: "data/projects/../projects/new.sqlite",
        migrationsFolder: join(projectRoot, "drizzle"),
      }),
    ).toThrow("旧 data/projects");
    expect(() =>
      createSqliteDatabase({
        cwd,
        filePath: "legacy-alias/new.sqlite",
        migrationsFolder: join(projectRoot, "drizzle"),
      }),
    ).toThrow("符号链接");
    await expect(
      assertDatabaseIntegrity(sentinelPath, { cwd }),
    ).rejects.toThrow("旧 data/projects");

    const source = createSqliteDatabase({
      cwd,
      filePath: "safe/source.sqlite",
      migrationsFolder: join(projectRoot, "drizzle"),
    });
    const safeBackupPath = join(cwd, "safe", "backup.sqlite");
    try {
      await expect(
        backupDatabase(
          source,
          "legacy-alias/backup.sqlite",
          { cwd },
        ),
      ).rejects.toThrow("符号链接");
      await backupDatabase(source, safeBackupPath, { cwd });
      await expect(
        restoreDatabase({
          backupPath: safeBackupPath,
          cwd,
          destinationPath: "data/projects/restored.sqlite",
        }),
      ).rejects.toThrow("旧 data/projects");

      const protectedBackupPath = join(
        legacyDirectory,
        "protected-backup.sqlite",
      );
      writeFileSync(
        protectedBackupPath,
        readFileSync(safeBackupPath),
      );
      const entriesWithFixture = readdirSync(legacyDirectory).sort();
      await expect(
        restoreDatabase({
          backupPath: protectedBackupPath,
          cwd,
          destinationPath: "safe/restored.sqlite",
        }),
      ).rejects.toThrow("旧 data/projects");
      expect(readdirSync(legacyDirectory).sort()).toEqual(
        entriesWithFixture,
      );
    } finally {
      source.close();
    }

    expect(readFileSync(sentinelPath, "utf8")).toBe("unchanged");
    expect(readdirSync(legacyDirectory).sort()).toEqual(
      [...initialEntries, "protected-backup.sqlite"].sort(),
    );
  });

  it("维护 API 使用 canonical 路径拒绝同文件 symlink 覆盖", async () => {
    const cwd = createTemporaryDirectory();
    const source = createSqliteDatabase({
      cwd,
      filePath: "safe/source.sqlite",
      migrationsFolder: join(projectRoot, "drizzle"),
    });
    const aliasPath = join(cwd, "source-alias.sqlite");
    symlinkSync(source.filePath, aliasPath, "file");

    try {
      await expect(
        backupDatabase(source, aliasPath, { cwd }),
      ).rejects.toThrow("符号链接");
      await expect(
        restoreDatabase({
          backupPath: aliasPath,
          cwd,
          destinationPath: source.filePath,
        }),
      ).rejects.toThrow("符号链接");
    } finally {
      source.close();
    }
  });

  it("逐组件拒绝安全与悬空 symlink，避免落入旧项目树", () => {
    const cwd = createTemporaryDirectory();
    const legacyDirectory = join(cwd, "data", "projects");
    const safeDirectory = join(cwd, "safe");
    mkdirSync(legacyDirectory, { recursive: true });
    mkdirSync(safeDirectory, { recursive: true });
    symlinkSync(
      join(legacyDirectory, "missing"),
      join(cwd, "dangling-alias"),
      "dir",
    );
    symlinkSync(safeDirectory, join(cwd, "safe-alias"), "dir");

    expect(() =>
      createSqliteDatabase({
        cwd,
        filePath: "dangling-alias/new.sqlite",
        migrationsFolder: join(projectRoot, "drizzle"),
      }),
    ).toThrow("符号链接");
    expect(() =>
      createSqliteDatabase({
        cwd,
        filePath: "safe-alias/new.sqlite",
        migrationsFolder: join(projectRoot, "drizzle"),
      }),
    ).toThrow("符号链接");
    expect(
      existsSync(join(legacyDirectory, "missing", "new.sqlite")),
    ).toBe(false);
  });
});
