import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MigrationLeaseLostError,
  withMigrationLock,
} from "@/platform/database";

const temporaryDirectories: string[] = [];

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "migration-lock-"));
  temporaryDirectories.push(directory);
  return directory;
}

const noHeartbeat = {
  start() {
    return () => undefined;
  },
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("跨进程迁移租约锁", () => {
  it("租约过期即可回收，即使旧记录 PID 等于当前进程", () => {
    const directory = createDirectory();
    const databasePath = join(directory, "database.sqlite");
    const lockPath = `${databasePath}.migrate.lock`;
    writeFileSync(
      lockPath,
      JSON.stringify({
        host: "old-host",
        leaseExpiresAt: "2000-01-01T00:00:00.000Z",
        ownerToken: "old-owner",
        pid: process.pid,
        processStartId: "old-process",
      }),
    );
    let executed = false;

    withMigrationLock(
      databasePath,
      () => {
        executed = true;
      },
      {
        clock: () => new Date("2026-08-30T00:00:00.000Z"),
        heartbeat: noHeartbeat,
        leaseDurationMs: 1_000,
        timeoutMs: 0,
      },
    );

    expect(executed).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("释放时不会删除已被其他 owner 替换的锁", () => {
    const directory = createDirectory();
    const databasePath = join(directory, "database.sqlite");
    const lockPath = `${databasePath}.migrate.lock`;

    withMigrationLock(
      databasePath,
      () => {
        writeFileSync(
          lockPath,
          JSON.stringify({
            host: "other-host",
            leaseExpiresAt: "2099-01-01T00:00:00.000Z",
            ownerToken: "other-owner",
            pid: 42,
            processStartId: "other-process",
          }),
        );
      },
      {
        heartbeat: noHeartbeat,
        leaseDurationMs: 1_000,
      },
    );

    expect(
      JSON.parse(readFileSync(lockPath, "utf8")),
    ).toMatchObject({ ownerToken: "other-owner" });
  });

  it("活跃 owner heartbeat 续期后不会被竞争者误回收", () => {
    const directory = createDirectory();
    mkdirSync(directory, { recursive: true });
    const databasePath = join(directory, "database.sqlite");
    let now = new Date("2026-08-30T00:00:00.000Z");
    let heartbeat: (() => void) | undefined;

    withMigrationLock(
      databasePath,
      () => {
        now = new Date("2026-08-30T00:00:00.900Z");
        heartbeat?.();
        now = new Date("2026-08-30T00:00:01.100Z");
        expect(() =>
          withMigrationLock(
            databasePath,
            () => undefined,
            {
              clock: () => now,
              heartbeat: noHeartbeat,
              leaseDurationMs: 1_000,
              timeoutMs: 0,
            },
          ),
        ).toThrow("迁移锁");
      },
      {
        clock: () => now,
        heartbeat: {
          start(options) {
            heartbeat = () => {
              expect(options.renewLease()).toBe(true);
            };
            return () => undefined;
          },
        },
        leaseDurationMs: 1_000,
      },
    );

    expect(heartbeat).toBeTypeOf("function");
  });

  it("operation 返回值前发现 lease lost 时抛错且不返回成功", () => {
    const directory = createDirectory();
    const databasePath = join(directory, "database.sqlite");
    let loseLease: (() => void) | undefined;
    let returned = false;

    expect(() => {
      withMigrationLock(
        databasePath,
        () => {
          loseLease?.();
          return "must-not-return";
        },
        {
          heartbeat: {
            start(options) {
              loseLease = options.onLeaseLost;
              return () => undefined;
            },
          },
          leaseDurationMs: 1_000,
        },
      );
      returned = true;
    }).toThrow(MigrationLeaseLostError);

    expect(returned).toBe(false);
    expect(existsSync(`${databasePath}.migrate.lock`)).toBe(false);
  });
});
