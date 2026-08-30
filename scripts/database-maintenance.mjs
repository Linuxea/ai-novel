import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import {
  pathsReferToSameLocation,
  resolvePathOutsideLegacyProjects,
} from "../src/platform/database/path-safety.ts";
import { withMigrationLock } from "../src/platform/database/migration-lock.ts";

const cwd = process.cwd();
const databaseSidecarSuffixes = ["-wal", "-shm", "-journal"];
const databasePath = resolvePathOutsideLegacyProjects(
  process.env.DATABASE_PATH?.trim() || "data/ai-novel.sqlite",
  { cwd, label: "SQLite 数据库" },
);

function write(message) {
  process.stdout.write(`${message}\n`);
}

function integrityCheck(client) {
  return client
    .prepare("PRAGMA integrity_check")
    .all()
    .map((row) => String(row.integrity_check));
}

function assertIntegrity(client, label) {
  const messages = integrityCheck(client);
  if (messages.length !== 1 || messages[0] !== "ok") {
    throw new Error(`${label}完整性检查失败: ${messages.join("; ")}`);
  }
}

function requirePathArgument(index, usage, label) {
  const value = process.argv[index]?.trim();
  if (!value) {
    throw new Error(`缺少路径参数，用法: ${usage}`);
  }
  return resolvePathOutsideLegacyProjects(value, { cwd, label });
}

function optionalDuration(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} 必须是非负安全整数`);
  }
  return parsed;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeDatabaseFile(filePath) {
  const client = new DatabaseSync(filePath, {
    enableForeignKeyConstraints: true,
  });
  try {
    assertIntegrity(client, "SQLite stage");
    client.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE",
    );
  } finally {
    client.close();
  }
}

function replaceClosedDatabase(stagedPath, destinationPath) {
  normalizeDatabaseFile(stagedPath);
  const quarantineId = randomUUID();
  const artifacts = [
    destinationPath,
    ...databaseSidecarSuffixes.map(
      (suffix) => `${destinationPath}${suffix}`,
    ),
  ];
  const isolated = new Map();
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
      renameSync(artifact, quarantinePath);
      isolated.set(artifact, quarantinePath);
    }
    renameSync(stagedPath, destinationPath);
    installed = true;
    const finalDatabase = new DatabaseSync(destinationPath, {
      readOnly: true,
    });
    try {
      assertIntegrity(finalDatabase, "最终数据库");
    } finally {
      finalDatabase.close();
    }
  } catch (error) {
    const rollbackFailures = [];
    if (installed) {
      for (const artifact of artifacts) {
        if (!existsSync(artifact)) {
          continue;
        }
        try {
          rmSync(artifact, { force: true });
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
          renameSync(quarantinePath, artifact);
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
      throw new Error(
        `SQLite 恢复失败且自动回滚不完整；请从以下 quarantine 路径人工恢复: ${recoveryPaths.join(", ")}；原始错误: ${String(error)}；回滚错误: ${rollbackFailures.join("; ")}`,
      );
    }
    throw error;
  }

  const cleanupFailures = [];
  const cleanupPaths = [
    ...databaseSidecarSuffixes.map(
      (suffix) => `${destinationPath}${suffix}`,
    ),
    ...isolated.values(),
  ];
  for (const cleanupPath of cleanupPaths) {
    if (!existsSync(cleanupPath)) {
      continue;
    }
    try {
      rmSync(cleanupPath, { force: true });
    } catch (cleanupError) {
      cleanupFailures.push(
        `${cleanupPath}: ${String(cleanupError)}`,
      );
    }
  }
  if (cleanupFailures.length > 0) {
    const residualPaths = cleanupPaths.filter((path) =>
      existsSync(path),
    );
    throw new Error(
      `SQLite 新库已成功安装，但 cleanup 未完成；保留路径: ${residualPaths.join(", ")}；清理错误: ${cleanupFailures.join("; ")}`,
    );
  }
}

async function createBackup(destinationPath) {
  if (
    pathsReferToSameLocation(databasePath, destinationPath, {
      cwd,
    })
  ) {
    throw new Error("备份目标不能覆盖源数据库");
  }
  mkdirSync(dirname(destinationPath), { recursive: true });
  const source = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
  });
  const temporaryPath = `${destinationPath}.backup-${randomUUID()}.tmp`;

  try {
    source.exec("PRAGMA wal_checkpoint(FULL)");
    const pages = await backup(source, temporaryPath);
    const verification = new DatabaseSync(temporaryPath, {
      enableForeignKeyConstraints: true,
      readOnly: true,
    });
    try {
      assertIntegrity(verification, "备份");
    } finally {
      verification.close();
    }
    replaceClosedDatabase(temporaryPath, destinationPath);
    write(`已备份 ${pages} 页到 ${destinationPath}`);
  } finally {
    source.close();
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath, { force: true });
    }
  }
}

async function restoreBackup(backupPath) {
  if (
    pathsReferToSameLocation(backupPath, databasePath, {
      cwd,
    })
  ) {
    throw new Error("恢复源与目标数据库不能相同");
  }
  const source = new DatabaseSync(backupPath, {
    enableForeignKeyConstraints: true,
    readOnly: true,
  });
  const temporaryPath = `${databasePath}.restore-${randomUUID()}.tmp`;
  mkdirSync(dirname(databasePath), { recursive: true });

  try {
    assertIntegrity(source, "恢复源");
    source.exec(
      `VACUUM INTO ${sqlString(temporaryPath)}`,
    );
    replaceClosedDatabase(temporaryPath, databasePath);
    write(`已从 ${backupPath} 原子恢复到 ${databasePath}`);
  } finally {
    source.close();
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath, { force: true });
    }
  }
}

async function main() {
  const action = process.argv[2];
  if (action === "migrate") {
    const migrationsFolder = resolvePathOutsideLegacyProjects(
      "drizzle",
      { cwd, label: "SQLite 迁移目录" },
    );
    mkdirSync(dirname(databasePath), { recursive: true });
    withMigrationLock(
      databasePath,
      () => {
        const client = new DatabaseSync(databasePath, {
          enableForeignKeyConstraints: true,
          timeout: 5_000,
        });
        try {
          client.exec("PRAGMA foreign_keys = ON");
          client.exec("PRAGMA journal_mode = WAL");
          client.exec("PRAGMA busy_timeout = 5000");
          migrate(drizzle({ client }), { migrationsFolder });
          write(`已迁移 ${databasePath}`);
        } finally {
          client.close();
        }
      },
      {
        staleAfterMs: optionalDuration(
          "DATABASE_MIGRATION_LOCK_STALE_MS",
        ),
        timeoutMs: optionalDuration(
          "DATABASE_MIGRATION_LOCK_TIMEOUT_MS",
        ),
      },
    );
    return;
  }
  if (action === "check") {
    const client = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
      readOnly: true,
    });
    try {
      assertIntegrity(client, "数据库");
      write(`${databasePath}: ok`);
    } finally {
      client.close();
    }
    return;
  }
  if (action === "backup") {
    await createBackup(
      requirePathArgument(
        3,
        "npm run db:backup -- <backup.sqlite>",
        "备份目标",
      ),
    );
    return;
  }
  if (action === "restore") {
    await restoreBackup(
      requirePathArgument(
        3,
        "npm run db:restore -- <backup.sqlite>",
        "恢复源",
      ),
    );
    return;
  }
  throw new Error(
    "未知操作；可用 migrate、check、backup、restore",
  );
}

await main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "数据库维护失败";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
