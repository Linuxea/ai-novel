import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { Worker } from "node:worker_threads";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_LEASE_DURATION_MS = 60_000;
const WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));
const PROCESS_START_ID = [
  hostname(),
  process.pid,
  Math.floor(Date.now() - process.uptime() * 1_000),
  randomUUID(),
].join(":");

export interface MigrationLockOptions {
  readonly clock?: () => Date;
  readonly heartbeat?: MigrationLockHeartbeat;
  readonly leaseDurationMs?: number;
  readonly staleAfterMs?: number;
  readonly timeoutMs?: number;
}

export interface MigrationLockHeartbeatStartOptions {
  readonly onLeaseLost: () => void;
  readonly renewLease: () => boolean;
}

export interface MigrationLockHeartbeat {
  start(options: MigrationLockHeartbeatStartOptions): () => void;
}

export class MigrationLeaseLostError extends Error {
  readonly code = "MIGRATION_LEASE_LOST";

  constructor(cause?: unknown) {
    super(
      "SQLite 迁移 operation 完成前已丢失迁移租约，结果不得视为成功",
      cause === undefined ? undefined : { cause },
    );
    this.name = "MigrationLeaseLostError";
  }
}

interface MigrationLockOwner {
  readonly acquiredAt?: string;
  readonly host: string;
  readonly leaseExpiresAt: string;
  readonly ownerToken: string;
  readonly pid: number;
  readonly processStartId: string;
}

function requireDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name}必须是非负安全整数`);
  }
  return value;
}

function readOwner(lockPath: string): MigrationLockOwner | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(lockPath, "utf8"),
    ) as Partial<MigrationLockOwner>;
    if (
      typeof parsed.host === "string" &&
      typeof parsed.leaseExpiresAt === "string" &&
      typeof parsed.ownerToken === "string" &&
      typeof parsed.pid === "number" &&
      typeof parsed.processStartId === "string"
    ) {
      return parsed as MigrationLockOwner;
    }
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      return undefined;
    }
  }
  return undefined;
}

function recoverStaleLock(
  lockPath: string,
  staleAfterMs: number,
  now: Date,
): boolean {
  let metadata;
  try {
    metadata = lstatSync(lockPath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return true;
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error("迁移锁文件不得为符号链接");
  }
  const owner = readOwner(lockPath);
  const leaseExpiresAt = owner
    ? Date.parse(owner.leaseExpiresAt)
    : metadata.mtimeMs + staleAfterMs;
  if (
    !Number.isFinite(leaseExpiresAt) ||
    leaseExpiresAt > now.getTime()
  ) {
    return false;
  }

  const current = lstatSync(lockPath);
  if (
    current.dev !== metadata.dev ||
    current.ino !== metadata.ino
  ) {
    return false;
  }
  const latestOwner = readOwner(lockPath);
  if (
    owner?.ownerToken !== latestOwner?.ownerToken ||
    (latestOwner &&
      Date.parse(latestOwner.leaseExpiresAt) > now.getTime())
  ) {
    return false;
  }
  unlinkSync(lockPath);
  return true;
}

function createWorkerHeartbeat(
  lockPath: string,
  ownerToken: string,
  leaseDurationMs: number,
): MigrationLockHeartbeat {
  return {
    start(options) {
      const stateBuffer = new SharedArrayBuffer(8);
      const state = new Int32Array(stateBuffer);
      const worker = new Worker(
        `
          const { workerData } = require("node:worker_threads");
          const fs = require("node:fs");
          const state = new Int32Array(workerData.stateBuffer);
          const intervalMs = Math.max(1, Math.floor(workerData.leaseDurationMs / 3));
          while (Atomics.load(state, 0) === 0) {
            Atomics.wait(state, 0, 0, intervalMs);
            if (Atomics.load(state, 0) !== 0) break;
            try {
              const current = JSON.parse(fs.readFileSync(workerData.lockPath, "utf8"));
              if (current.ownerToken !== workerData.ownerToken) break;
              current.leaseExpiresAt = new Date(Date.now() + workerData.leaseDurationMs).toISOString();
              const temporaryPath = workerData.lockPath + ".heartbeat-" + workerData.ownerToken;
              fs.writeFileSync(temporaryPath, JSON.stringify(current), { mode: 0o600 });
              const latest = JSON.parse(fs.readFileSync(workerData.lockPath, "utf8"));
              if (latest.ownerToken !== workerData.ownerToken) {
                fs.rmSync(temporaryPath, { force: true });
                break;
              }
              fs.renameSync(temporaryPath, workerData.lockPath);
            } catch {
              break;
            }
          }
          Atomics.store(state, 1, 1);
          Atomics.notify(state, 1);
        `,
        {
          eval: true,
          workerData: {
            leaseDurationMs,
            lockPath,
            ownerToken,
            stateBuffer,
          },
        },
      );
      worker.unref();
      const monitor = globalThis.setInterval(() => {
        if (Atomics.load(state, 1) === 1) {
          globalThis.clearInterval(monitor);
          options.onLeaseLost();
        }
      }, Math.max(1, Math.floor(leaseDurationMs / 3)));
      monitor.unref?.();
      return () => {
        globalThis.clearInterval(monitor);
        Atomics.store(state, 0, 1);
        Atomics.notify(state, 0);
        Atomics.wait(state, 1, 0, 1_000);
        void worker.terminate();
      };
    },
  };
}

export function withMigrationLock<TResult>(
  databasePath: string,
  operation: () => TResult,
  options: MigrationLockOptions = {},
): TResult {
  if (databasePath === ":memory:") {
    return operation();
  }
  const timeoutMs = requireDuration(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "迁移锁等待时间",
  );
  const legacyStaleAfterMs = requireDuration(
    options.staleAfterMs ?? DEFAULT_LEASE_DURATION_MS,
    "迁移锁陈旧时间",
  );
  const leaseDurationMs = requireDuration(
    options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
    "迁移锁租约时长",
  );
  if (leaseDurationMs < 1) {
    throw new Error("迁移锁租约时长必须大于零");
  }
  const clock = options.clock ?? (() => new Date());
  const lockPath = `${databasePath}.migrate.lock`;
  const startedAt = Date.now();
  const ownerToken = randomUUID();
  let acquiredOwner: MigrationLockOwner | undefined;

  while (true) {
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      const now = clock();
      acquiredOwner = {
        acquiredAt: now.toISOString(),
        host: hostname(),
        leaseExpiresAt: new Date(
          now.getTime() + leaseDurationMs,
        ).toISOString(),
        ownerToken,
        pid: process.pid,
        processStartId: PROCESS_START_ID,
      };
      try {
        writeFileSync(
          descriptor,
          JSON.stringify(acquiredOwner),
        );
      } finally {
        closeSync(descriptor);
      }
      break;
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )
      ) {
        throw error;
      }
      if (
        recoverStaleLock(
          lockPath,
          legacyStaleAfterMs,
          clock(),
        )
      ) {
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error("等待 SQLite 迁移锁超时");
      }
      Atomics.wait(
        WAIT_ARRAY,
        0,
        0,
        Math.min(10, timeoutMs - (Date.now() - startedAt)),
      );
    }
  }

  const renewLease = (): boolean => {
    const currentOwner = readOwner(lockPath);
    if (currentOwner?.ownerToken !== ownerToken) {
      return false;
    }
    const renewedOwner = {
      ...currentOwner,
      leaseExpiresAt: new Date(
        clock().getTime() + leaseDurationMs,
      ).toISOString(),
    };
    const temporaryPath = `${lockPath}.heartbeat-${ownerToken}`;
    writeFileSync(temporaryPath, JSON.stringify(renewedOwner), {
      mode: 0o600,
    });
    const latestOwner = readOwner(lockPath);
    if (latestOwner?.ownerToken !== ownerToken) {
      unlinkSync(temporaryPath);
      return false;
    }
    renameSync(temporaryPath, lockPath);
    return true;
  };
  let leaseLost = false;
  const heartbeat =
    options.heartbeat ??
    createWorkerHeartbeat(lockPath, ownerToken, leaseDurationMs);
  const stopHeartbeat = heartbeat.start({
    onLeaseLost() {
      leaseLost = true;
    },
    renewLease,
  });
  let operationFailed = false;
  let operationError: unknown;
  let result: TResult | undefined;
  try {
    result = operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  } finally {
    try {
      stopHeartbeat();
    } finally {
      const currentOwner = readOwner(lockPath);
      if (
        currentOwner?.ownerToken === acquiredOwner?.ownerToken
      ) {
        unlinkSync(lockPath);
      }
    }
  }
  if (leaseLost) {
    throw new MigrationLeaseLostError(
      operationFailed ? operationError : undefined,
    );
  }
  if (operationFailed) {
    throw operationError;
  }
  return result as TResult;
}
