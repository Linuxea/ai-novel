import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  fork,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = join(
  projectRoot,
  "scripts",
  "database-maintenance.mjs",
);
const temporaryDirectories: string[] = [];
const migrationWorkerPath = join(
  projectRoot,
  "tests",
  "fixtures",
  "concurrent-migration-worker.mjs",
);

function waitForWorkerMessage(
  worker: ChildProcess,
  type: "ready" | "result",
): Promise<Record<string, unknown>> {
  return new Promise((resolveMessage, rejectMessage) => {
    const onError = (error: Error) => {
      worker.off("message", onMessage);
      rejectMessage(error);
    };
    const onMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === type
      ) {
        worker.off("error", onError);
        worker.off("message", onMessage);
        resolveMessage(message as Record<string, unknown>);
      }
    };
    worker.once("error", onError);
    worker.on("message", onMessage);
  });
}

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "ai-novel-db-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createDatabase(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const client = new DatabaseSync(filePath);
  try {
    client.exec(
      "CREATE TABLE probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    client
      .prepare("INSERT INTO probe (id, value) VALUES (?, ?)")
      .run("probe-1", "safe");
  } finally {
    client.close();
  }
}

function createWalCrashImage(
  destinationPath: string,
  backupPath: string,
): void {
  mkdirSync(dirname(destinationPath), { recursive: true });
  const client = new DatabaseSync(destinationPath);
  const savedMain = `${destinationPath}.saved-main`;
  const savedWal = `${destinationPath}.saved-wal`;
  const savedShm = `${destinationPath}.saved-shm`;
  try {
    client.exec(
      "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE restore_probe (value TEXT NOT NULL); INSERT INTO restore_probe VALUES ('backup'); PRAGMA wal_checkpoint(TRUNCATE)",
    );
    client.exec(
      `VACUUM INTO '${backupPath.replaceAll("'", "''")}'`,
    );
    client.exec(
      "UPDATE restore_probe SET value = 'stale'",
    );
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

function runMaintenance(
  cwd: string,
  databasePath: string,
  action: string,
  operand?: string,
  extraEnvironment: Readonly<
    Record<string, string | undefined>
  > = {},
) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      action,
      ...(operand === undefined ? [] : [operand]),
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        ...extraEnvironment,
      },
    },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("数据库维护脚本路径保护", () => {
  it("migrate 和 check 在打开文件前拒绝旧项目数据库路径", () => {
    const cwd = createDirectory();
    const legacyDirectory = join(cwd, "data", "projects");
    const sentinelPath = join(legacyDirectory, "sentinel.txt");
    mkdirSync(legacyDirectory, { recursive: true });
    writeFileSync(sentinelPath, "unchanged");

    const migrate = runMaintenance(
      cwd,
      "data/projects/../projects/new.sqlite",
      "migrate",
    );
    const check = runMaintenance(
      cwd,
      sentinelPath,
      "check",
    );

    expect(migrate.status).toBe(1);
    expect(migrate.stderr).toContain("旧 data/projects");
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("旧 data/projects");
    expect(readdirSync(legacyDirectory)).toEqual(["sentinel.txt"]);
    expect(readFileSync(sentinelPath, "utf8")).toBe("unchanged");
  });

  it("backup 在创建目标前拒绝旧目录的 symlink 别名", () => {
    const cwd = createDirectory();
    const legacyDirectory = join(cwd, "data", "projects");
    const safeDatabasePath = join(cwd, "safe", "source.sqlite");
    const aliasPath = join(cwd, "legacy-alias");
    mkdirSync(legacyDirectory, { recursive: true });
    writeFileSync(join(legacyDirectory, "sentinel.txt"), "unchanged");
    createDatabase(safeDatabasePath);
    symlinkSync(legacyDirectory, aliasPath, "dir");

    const result = runMaintenance(
      cwd,
      safeDatabasePath,
      "backup",
      join(aliasPath, "backup.sqlite"),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("符号链接");
    expect(readdirSync(legacyDirectory)).toEqual(["sentinel.txt"]);
  });

  it("restore 在打开备份前拒绝旧目录中的源文件", () => {
    const cwd = createDirectory();
    const legacyDirectory = join(cwd, "data", "projects");
    const protectedBackupPath = join(
      legacyDirectory,
      "backup.sqlite",
    );
    mkdirSync(legacyDirectory, { recursive: true });
    createDatabase(protectedBackupPath);

    const result = runMaintenance(
      cwd,
      join(cwd, "safe", "destination.sqlite"),
      "restore",
      protectedBackupPath,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("旧 data/projects");
    expect(existsSync(join(cwd, "safe"))).toBe(false);
  });

  it("restore 在覆盖前拒绝旧目录中的目标文件", () => {
    const cwd = createDirectory();
    const legacyDirectory = join(cwd, "data", "projects");
    const destinationPath = join(
      legacyDirectory,
      "destination.sqlite",
    );
    const backupPath = join(cwd, "safe", "backup.sqlite");
    mkdirSync(legacyDirectory, { recursive: true });
    writeFileSync(destinationPath, "unchanged");
    createDatabase(backupPath);

    const result = runMaintenance(
      cwd,
      destinationPath,
      "restore",
      backupPath,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("旧 data/projects");
    expect(readFileSync(destinationPath, "utf8")).toBe("unchanged");
  });

  it("restore 清除旧 WAL sidecar 并恢复备份值", () => {
    const cwd = createDirectory();
    const destinationPath = join(cwd, "destination.sqlite");
    const backupPath = join(cwd, "backup.sqlite");
    createWalCrashImage(destinationPath, backupPath);

    const result = runMaintenance(
      cwd,
      destinationPath,
      "restore",
      backupPath,
    );

    expect(result.status).toBe(0);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      expect(existsSync(`${destinationPath}${suffix}`)).toBe(false);
    }
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

  it("restore CLI 用有效备份替换损坏目标和 sidecars", () => {
    const cwd = createDirectory();
    const destinationPath = join(cwd, "damaged.sqlite");
    const backupPath = join(cwd, "backup.sqlite");
    createDatabase(backupPath);
    writeFileSync(destinationPath, "not sqlite");
    writeFileSync(`${destinationPath}-wal`, "bad wal");
    writeFileSync(`${destinationPath}-shm`, "bad shm");
    writeFileSync(`${destinationPath}-journal`, "bad journal");

    const result = runMaintenance(
      cwd,
      destinationPath,
      "restore",
      backupPath,
    );

    expect(result.status).toBe(0);
    const restored = new DatabaseSync(destinationPath, {
      readOnly: true,
    });
    try {
      expect(
        restored.prepare("SELECT value FROM probe").get(),
      ).toEqual({ value: "safe" });
    } finally {
      restored.close();
    }
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      expect(existsSync(`${destinationPath}${suffix}`)).toBe(false);
    }
  });

  it("所有命令拒绝任一路径组件中的悬空 symlink", () => {
    const cwd = createDirectory();
    const legacyDirectory = join(cwd, "data", "projects");
    mkdirSync(legacyDirectory, { recursive: true });
    symlinkSync(
      join(legacyDirectory, "missing"),
      join(cwd, "dangling"),
      "dir",
    );

    const result = runMaintenance(
      cwd,
      "dangling/database.sqlite",
      "check",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("符号链接");
    expect(existsSync(join(legacyDirectory, "missing"))).toBe(false);
  });

  it("多个进程同步首次迁移时都成功且只应用一次", async () => {
    const directory = createDirectory();
    const databasePath = join(directory, "concurrent.sqlite");
    const expectedMigrationCount = readdirSync(
      join(projectRoot, "drizzle"),
      { withFileTypes: true },
    ).filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(
          join(projectRoot, "drizzle", entry.name, "migration.sql"),
        ),
    ).length;
    const workers = Array.from({ length: 4 }, () =>
      fork(migrationWorkerPath, [scriptPath], {
        cwd: projectRoot,
        env: {
          ...process.env,
          DATABASE_PATH: databasePath,
        },
        silent: true,
      }),
    );

    try {
      await Promise.all(
        workers.map((worker) =>
          waitForWorkerMessage(worker, "ready"),
        ),
      );
      const results = workers.map((worker) =>
        waitForWorkerMessage(worker, "result"),
      );
      for (const worker of workers) {
        worker.send("start");
      }
      const completed = await Promise.all(results);

      expect(completed.map((result) => result.status)).toEqual([
        0,
        0,
        0,
        0,
      ]);
      const database = new DatabaseSync(databasePath, {
        readOnly: true,
      });
      try {
        expect(
          database
            .prepare(
              "SELECT count(*) AS count FROM __drizzle_migrations",
            )
            .get(),
        ).toEqual({ count: expectedMigrationCount });
      } finally {
        database.close();
      }
    } finally {
      for (const worker of workers) {
        if (worker.connected) {
          worker.disconnect();
        }
        worker.kill();
      }
    }
  });

  it("有效迁移锁阻止另一个进程执行陈旧 migration", () => {
    const cwd = createDirectory();
    const databasePath = join(cwd, "locked.sqlite");
    writeFileSync(
      `${databasePath}.migrate.lock`,
      JSON.stringify({
        acquiredAt: new Date().toISOString(),
        owner: "other-process",
        pid: process.pid,
      }),
    );

    const result = runMaintenance(
      projectRoot,
      databasePath,
      "migrate",
      undefined,
      { DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "0" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("迁移锁");
    expect(existsSync(databasePath)).toBe(false);
  });

  it("仅回收 owner 已失效且超时的 stale 迁移锁", () => {
    const cwd = createDirectory();
    const databasePath = join(cwd, "stale-lock.sqlite");
    const lockPath = `${databasePath}.migrate.lock`;
    writeFileSync(
      lockPath,
      JSON.stringify({
        acquiredAt: "2000-01-01T00:00:00.000Z",
        owner: "dead-process",
        pid: 2_147_483_647,
      }),
    );

    const result = runMaintenance(
      projectRoot,
      databasePath,
      "migrate",
      undefined,
      {
        DATABASE_MIGRATION_LOCK_STALE_MS: "0",
        DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "100",
      },
    );

    expect(result.status).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(databasePath)).toBe(true);
  });
});
