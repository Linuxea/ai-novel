import { randomUUID } from "node:crypto";
import type {
  SqliteDatabaseConnection,
  UnitOfWorkContext,
} from "@/platform/database";
import { serializeSafeError } from "@/platform/observability";
import type {
  JobCatalog,
  JobCatalogInput,
  JobCatalogPayload,
} from "./job-catalog";
import {
  JobPayloadCompatibilityError,
  JobPayloadSerializationError,
} from "./job-catalog";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface JobRecord<
  TPayload = unknown,
  TResult = unknown,
> {
  readonly attempt: number;
  readonly cancelRequestedAt?: string;
  readonly createdAt: string;
  readonly error?: unknown;
  readonly finishedAt?: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly leaseExpiresAt?: string;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly maxAttempts: number;
  readonly payload: TPayload;
  readonly progress: number;
  readonly result?: TResult;
  readonly runAt: string;
  readonly startedAt?: string;
  readonly status: JobStatus;
  readonly type: string;
  readonly updatedAt: string;
}

export interface JobClaim {
  readonly leaseToken: string;
  readonly record: JobRecord;
}

export interface JobEvent<TData = unknown> {
  readonly createdAt: string;
  readonly cursor: number;
  readonly data: TData;
  readonly jobId: string;
  readonly type: string;
}

export interface EnqueueJobInput<
  TPayload,
  TType extends string = string,
> {
  readonly idempotencyKey: string;
  readonly maxAttempts?: number;
  readonly payload: TPayload;
  readonly runAt?: Date;
  readonly type: TType;
}

export interface ClaimJobOptions {
  readonly leaseDurationMs: number;
  readonly types?: readonly string[];
  readonly workerId: string;
}

export interface FailJobOptions {
  readonly retryable: boolean;
  readonly retryDelayMs: number;
}

export interface ListJobEventsOptions {
  readonly afterCursor?: number;
  readonly jobId?: string;
  readonly limit?: number;
}

export interface JobRepositoryOptions<
  TCatalog extends JobCatalog = JobCatalog,
> {
  readonly catalog?: TCatalog;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly leaseTokenGenerator?: () => string;
}

export interface JobRepository<
  TCatalog extends JobCatalog = JobCatalog,
> {
  acknowledgeCancellation(claim: JobClaim): boolean;
  claimNext(options: ClaimJobOptions): JobClaim | undefined;
  enqueue<TKey extends keyof TCatalog & string>(
    input: EnqueueJobInput<
      JobCatalogInput<TCatalog, TKey>,
      TKey
    >,
  ): JobRecord<JobCatalogPayload<TCatalog, TKey>>;
  fail(
    claim: JobClaim,
    error: unknown,
    options: FailJobOptions,
  ): boolean;
  get(jobId: string): JobRecord | undefined;
  isCancellationRequested(jobId: string): boolean;
  listEvents(options?: ListJobEventsOptions): readonly JobEvent[];
  reportProgress(
    claim: JobClaim,
    progress: number,
    data?: Readonly<Record<string, unknown>>,
  ): boolean;
  renewLease(claim: JobClaim, leaseDurationMs: number): boolean;
  requestCancel(jobId: string): JobRecord | undefined;
  succeed<TResult>(claim: JobClaim, result: TResult): boolean;
}

interface JobRow {
  readonly attempt: number;
  readonly cancel_requested_at: string | null;
  readonly created_at: string;
  readonly error_json: string | null;
  readonly finished_at: string | null;
  readonly id: string;
  readonly idempotency_key: string;
  readonly lease_expires_at: string | null;
  readonly lease_owner: string | null;
  readonly lease_token: string | null;
  readonly max_attempts: number;
  readonly payload_json: string;
  readonly progress: number;
  readonly result_json: string | null;
  readonly run_at: string;
  readonly started_at: string | null;
  readonly status: string;
  readonly type: string;
  readonly updated_at: string;
}

interface JobEventRow {
  readonly created_at: string;
  readonly cursor: number;
  readonly data_json: string;
  readonly event_type: string;
  readonly job_id: string;
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name}不能为空`);
  }
  return normalized;
}

function requireIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${name}必须是 ${minimum} 到 ${maximum} 之间的安全整数`,
    );
  }
  return value;
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("任务 JSON 值不能是 undefined");
  }
  return serialized;
}

function parseJson(value: string | null): unknown {
  return value === null ? undefined : (JSON.parse(value) as unknown);
}

function optionalString(value: string | null): string | undefined {
  return value ?? undefined;
}

function parseStatus(value: string): JobStatus {
  if (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error(`未知任务状态: ${value}`);
}

function mapJobRow<TPayload = unknown, TResult = unknown>(
  row: JobRow,
): JobRecord<TPayload, TResult> {
  return {
    attempt: row.attempt,
    cancelRequestedAt: optionalString(row.cancel_requested_at),
    createdAt: row.created_at,
    error: parseJson(row.error_json),
    finishedAt: optionalString(row.finished_at),
    id: row.id,
    idempotencyKey: row.idempotency_key,
    leaseExpiresAt: optionalString(row.lease_expires_at),
    leaseOwner: optionalString(row.lease_owner),
    leaseToken: optionalString(row.lease_token),
    maxAttempts: row.max_attempts,
    payload: parseJson(row.payload_json) as TPayload,
    progress: row.progress,
    result: parseJson(row.result_json) as TResult | undefined,
    runAt: row.run_at,
    startedAt: optionalString(row.started_at),
    status: parseStatus(row.status),
    type: row.type,
    updatedAt: row.updated_at,
  };
}

export function createJobRepository<
  TCatalog extends JobCatalog = JobCatalog,
>(
  connection: SqliteDatabaseConnection,
  options: JobRepositoryOptions<TCatalog> = {},
): JobRepository<TCatalog> {
  const clock = options.clock ?? (() => new Date());
  const idGenerator = options.idGenerator ?? randomUUID;
  const leaseTokenGenerator =
    options.leaseTokenGenerator ?? randomUUID;

  function get(jobId: string): JobRecord | undefined {
    const row = connection.client
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(jobId) as unknown as JobRow | undefined;
    return row ? mapJobRow(row) : undefined;
  }

  function appendEvent(
    transaction: UnitOfWorkContext,
    jobId: string,
    type: string,
    data: unknown,
    createdAt: string,
  ): void {
    transaction.client
      .prepare(
        "INSERT INTO job_events (job_id, event_type, data_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(jobId, type, serializeJson(data), createdAt);
  }

  function commitRequestedCancellation(
    transaction: UnitOfWorkContext,
    claim: JobClaim,
    now: string,
  ): boolean {
    const result = transaction.client
      .prepare(
        `UPDATE jobs
         SET status = 'cancelled',
             lease_owner = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             finished_at = ?,
             updated_at = ?
         WHERE id = ?
           AND status = 'running'
           AND lease_token = ?
           AND cancel_requested_at IS NOT NULL`,
      )
      .run(
        now,
        now,
        claim.record.id,
        claim.leaseToken,
      );
    if (Number(result.changes) !== 1) {
      return false;
    }
    appendEvent(
      transaction,
      claim.record.id,
      "cancelled",
      { attempt: claim.record.attempt },
      now,
    );
    return true;
  }

  function typeFilter(types: readonly string[] | undefined): {
    readonly parameters: readonly string[];
    readonly sql: string;
  } {
    if (types === undefined) {
      return { parameters: [], sql: "" };
    }
    if (types.length === 0) {
      return { parameters: [], sql: " AND 0 = 1" };
    }
    const normalized = types.map((type) =>
      requireNonEmpty(type, "任务类型"),
    );
    return {
      parameters: normalized,
      sql: ` AND type IN (${normalized.map(() => "?").join(", ")})`,
    };
  }

  return {
    acknowledgeCancellation(claim) {
      const now = clock().toISOString();
      return connection.unitOfWork.run((transaction) =>
        commitRequestedCancellation(transaction, claim, now),
      );
    },
    claimNext(claimOptions) {
      const leaseDurationMs = requireIntegerInRange(
        claimOptions.leaseDurationMs,
        1,
        Number.MAX_SAFE_INTEGER,
        "任务租约时长",
      );
      const workerId = requireNonEmpty(
        claimOptions.workerId,
        "任务工作器标识",
      );
      const filter = typeFilter(claimOptions.types);
      const now = clock();
      const nowIso = now.toISOString();
      const leaseExpiresAt = new Date(
        now.getTime() + leaseDurationMs,
      ).toISOString();
      const leaseToken = leaseTokenGenerator();

      return connection.unitOfWork.run((transaction) => {
        const cancelled = transaction.client
          .prepare(
            `UPDATE jobs
             SET status = 'cancelled',
                 lease_owner = NULL,
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 finished_at = ?,
                 updated_at = ?
             WHERE id = (
               SELECT id FROM jobs
               WHERE status = 'running'
                 AND lease_expires_at <= ?
                 AND cancel_requested_at IS NOT NULL
                 ${filter.sql}
               ORDER BY updated_at, id
               LIMIT 1
             )
             RETURNING id`,
          )
          .get(
            nowIso,
            nowIso,
            nowIso,
            ...filter.parameters,
          ) as { id: string } | undefined;
        if (cancelled) {
          appendEvent(
            transaction,
            cancelled.id,
            "cancelled",
            { recoveredExpiredLease: true },
            nowIso,
          );
        }

        const leaseExpiredError = {
          code: "lease_expired",
          message:
            "任务处理租约过期且已耗尽最大尝试次数",
          name: "LeaseExpiredError",
        };
        const exhausted = transaction.client
          .prepare(
            `UPDATE jobs
             SET status = 'failed',
                 lease_owner = NULL,
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 error_json = ?,
                 finished_at = ?,
                 updated_at = ?
             WHERE id = (
               SELECT id FROM jobs
               WHERE status = 'running'
                 AND lease_expires_at <= ?
                 AND cancel_requested_at IS NULL
                 AND attempt >= max_attempts
                 ${filter.sql}
               ORDER BY updated_at, id
               LIMIT 1
             )
             RETURNING id, attempt`,
          )
          .get(
            serializeJson(leaseExpiredError),
            nowIso,
            nowIso,
            nowIso,
            ...filter.parameters,
          ) as
          | { attempt: number; id: string }
          | undefined;
        if (exhausted) {
          appendEvent(
            transaction,
            exhausted.id,
            "failed",
            {
              attempt: exhausted.attempt,
              error: leaseExpiredError,
              recoveredExpiredLease: true,
            },
            nowIso,
          );
        }

        const row = transaction.client
          .prepare(
            `UPDATE jobs
             SET status = 'running',
                 attempt = attempt + 1,
                 progress = 0,
                 lease_owner = ?,
                 lease_token = ?,
                 lease_expires_at = ?,
                 started_at = COALESCE(started_at, ?),
                 updated_at = ?
             WHERE id = (
               SELECT id
               FROM jobs
               WHERE (
                   (status = 'queued' AND run_at <= ?)
                   OR
                   (status = 'running' AND lease_expires_at <= ?)
                 )
                 AND cancel_requested_at IS NULL
                 AND attempt < max_attempts
                 ${filter.sql}
               ORDER BY run_at, created_at, id
               LIMIT 1
             )
             RETURNING *`,
          )
          .get(
            workerId,
            leaseToken,
            leaseExpiresAt,
            nowIso,
            nowIso,
            nowIso,
            nowIso,
            ...filter.parameters,
          ) as unknown as JobRow | undefined;
        if (!row) {
          return undefined;
        }

        const record = mapJobRow(row);
        appendEvent(
          transaction,
          record.id,
          "running",
          {
            attempt: record.attempt,
            leaseOwner: workerId,
          },
          nowIso,
        );
        return { leaseToken, record };
      });
    },
    enqueue(input) {
      const type = requireNonEmpty(input.type, "任务类型");
      const idempotencyKey = requireNonEmpty(
        input.idempotencyKey,
        "任务幂等键",
      );
      const maxAttempts = requireIntegerInRange(
        input.maxAttempts ?? 3,
        1,
        Number.MAX_SAFE_INTEGER,
        "任务最大尝试次数",
      );
      const now = clock().toISOString();
      const runAt = (input.runAt ?? new Date(now)).toISOString();
      const id = idGenerator();
      const definition = options.catalog?.[type];
      if (options.catalog && !definition) {
        throw new Error(`任务类型未在 JobCatalog 注册: ${type}`);
      }
      const parsedPayload = definition
        ? definition.payloadSchema.safeParse(input.payload)
        : undefined;
      if (parsedPayload && !parsedPayload.success) {
        throw new Error(
          `任务 payload 校验失败: ${parsedPayload.error.message}`,
        );
      }
      const payload = (
        parsedPayload ? parsedPayload.data : input.payload
      ) as JobCatalogPayload<TCatalog, typeof input.type>;
      let payloadJson: string;
      try {
        payloadJson = serializeJson(payload);
      } catch (error) {
        if (payload === undefined) {
          throw new JobPayloadSerializationError(type);
        }
        throw error;
      }

      return connection.unitOfWork.run((transaction) => {
        const result = transaction.client
          .prepare(
            `INSERT INTO jobs (
               id, type, payload_json, status, idempotency_key,
               attempt, max_attempts, run_at, progress,
               created_at, updated_at
             ) VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, 0, ?, ?)
             ON CONFLICT(type, idempotency_key) DO NOTHING`,
          )
          .run(
            id,
            type,
            payloadJson,
            idempotencyKey,
            maxAttempts,
            runAt,
            now,
            now,
          );
        if (Number(result.changes) === 1) {
          appendEvent(
            transaction,
            id,
            "queued",
            { runAt },
            now,
          );
        }

        const row = transaction.client
          .prepare(
            "SELECT * FROM jobs WHERE type = ? AND idempotency_key = ?",
          )
          .get(type, idempotencyKey) as unknown as JobRow | undefined;
        if (!row) {
          throw new Error("任务入队后无法读取");
        }
        if (Number(result.changes) === 1) {
          return {
            ...mapJobRow<typeof payload>(row),
            payload,
          };
        }
        if (!definition) {
          return mapJobRow<
            JobCatalogPayload<TCatalog, typeof input.type>
          >(row);
        }
        const persistedPayload = parseJson(row.payload_json);
        const parsedPersistedPayload =
          definition.payloadSchema.safeParse(persistedPayload);
        if (!parsedPersistedPayload.success) {
          throw new JobPayloadCompatibilityError(
            type,
            idempotencyKey,
            parsedPersistedPayload.error.message,
          );
        }
        if (parsedPersistedPayload.data === undefined) {
          throw new JobPayloadSerializationError(type);
        }
        const compatiblePayload =
          parsedPersistedPayload.data as JobCatalogPayload<
            TCatalog,
            typeof input.type
          >;
        return {
          ...mapJobRow<
            JobCatalogPayload<TCatalog, typeof input.type>
          >(row),
          payload: compatiblePayload,
        };
      });
    },
    fail(claim, error, failOptions) {
      const retryDelayMs = requireIntegerInRange(
        failOptions.retryDelayMs,
        0,
        Number.MAX_SAFE_INTEGER,
        "任务重试延迟",
      );
      const now = clock();
      const nowIso = now.toISOString();
      const terminal =
        !failOptions.retryable ||
        claim.record.attempt >= claim.record.maxAttempts;
      const status = terminal ? "failed" : "queued";
      const runAt = terminal
        ? claim.record.runAt
        : new Date(now.getTime() + retryDelayMs).toISOString();
      const serializedError = serializeSafeError(error);

      return connection.unitOfWork.run((transaction) => {
        if (
          commitRequestedCancellation(
            transaction,
            claim,
            nowIso,
          )
        ) {
          return true;
        }
        const result = transaction.client
          .prepare(
            `UPDATE jobs
             SET status = ?,
                 run_at = ?,
                 lease_owner = NULL,
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 error_json = ?,
                 finished_at = ?,
                 updated_at = ?
             WHERE id = ?
               AND status = 'running'
               AND lease_token = ?
               AND cancel_requested_at IS NULL`,
          )
          .run(
            status,
            runAt,
            serializeJson(serializedError),
            terminal ? nowIso : null,
            nowIso,
            claim.record.id,
            claim.leaseToken,
          );
        if (Number(result.changes) !== 1) {
          return false;
        }
        appendEvent(
          transaction,
          claim.record.id,
          terminal ? "failed" : "retry_scheduled",
          {
            attempt: claim.record.attempt,
            error: serializedError,
            ...(terminal ? {} : { runAt }),
          },
          nowIso,
        );
        return true;
      });
    },
    get,
    isCancellationRequested(jobId) {
      const record = get(jobId);
      return Boolean(
        record &&
          (record.status === "cancelled" ||
            record.cancelRequestedAt),
      );
    },
    listEvents(listOptions = {}) {
      const afterCursor = requireIntegerInRange(
        listOptions.afterCursor ?? 0,
        0,
        Number.MAX_SAFE_INTEGER,
        "任务事件游标",
      );
      const limit = requireIntegerInRange(
        listOptions.limit ?? 100,
        1,
        1_000,
        "任务事件数量",
      );
      const rows = listOptions.jobId
        ? connection.client
            .prepare(
              `SELECT * FROM job_events
               WHERE cursor > ? AND job_id = ?
               ORDER BY cursor
               LIMIT ?`,
            )
            .all(afterCursor, listOptions.jobId, limit)
        : connection.client
            .prepare(
              `SELECT * FROM job_events
               WHERE cursor > ?
               ORDER BY cursor
               LIMIT ?`,
            )
            .all(afterCursor, limit);

      return (rows as unknown as JobEventRow[]).map((row) => ({
        createdAt: row.created_at,
        cursor: row.cursor,
        data: JSON.parse(row.data_json) as unknown,
        jobId: row.job_id,
        type: row.event_type,
      }));
    },
    reportProgress(claim, progress, data = {}) {
      const normalizedProgress = requireIntegerInRange(
        progress,
        0,
        100,
        "任务进度",
      );
      const now = clock().toISOString();

      return connection.unitOfWork.run((transaction) => {
        const result = transaction.client
          .prepare(
            `UPDATE jobs
             SET progress = ?, updated_at = ?
             WHERE id = ?
               AND status = 'running'
               AND lease_token = ?
               AND cancel_requested_at IS NULL
               AND progress <= ?`,
          )
          .run(
            normalizedProgress,
            now,
            claim.record.id,
            claim.leaseToken,
            normalizedProgress,
          );
        if (Number(result.changes) !== 1) {
          return false;
        }
        appendEvent(
          transaction,
          claim.record.id,
          "progress",
          {
            ...data,
            attempt: claim.record.attempt,
            progress: normalizedProgress,
          },
          now,
        );
        return true;
      });
    },
    renewLease(claim, leaseDurationMs) {
      const duration = requireIntegerInRange(
        leaseDurationMs,
        1,
        Number.MAX_SAFE_INTEGER,
        "任务租约时长",
      );
      const now = clock();
      const nowIso = now.toISOString();
      const leaseExpiresAt = new Date(
        now.getTime() + duration,
      ).toISOString();
      const result = connection.client
        .prepare(
          `UPDATE jobs
           SET lease_expires_at = ?, updated_at = ?
           WHERE id = ?
             AND status = 'running'
             AND lease_token = ?
             AND cancel_requested_at IS NULL
             AND lease_expires_at > ?`,
        )
        .run(
          leaseExpiresAt,
          nowIso,
          claim.record.id,
          claim.leaseToken,
          nowIso,
        );
      return Number(result.changes) === 1;
    },
    requestCancel(jobId) {
      const now = clock().toISOString();
      return connection.unitOfWork.run((transaction) => {
        const current = get(jobId);
        if (!current) {
          return undefined;
        }
        if (current.status === "queued") {
          const result = transaction.client
            .prepare(
              `UPDATE jobs
               SET status = 'cancelled',
                   cancel_requested_at = ?,
                   finished_at = ?,
                   updated_at = ?
               WHERE id = ? AND status = 'queued'`,
            )
            .run(now, now, now, jobId);
          if (Number(result.changes) === 1) {
            appendEvent(
              transaction,
              jobId,
              "cancelled",
              {},
              now,
            );
          }
        } else if (
          current.status === "running" &&
          !current.cancelRequestedAt
        ) {
          const result = transaction.client
            .prepare(
              `UPDATE jobs
               SET cancel_requested_at = ?, updated_at = ?
               WHERE id = ?
                 AND status = 'running'
                 AND cancel_requested_at IS NULL`,
            )
            .run(now, now, jobId);
          if (Number(result.changes) === 1) {
            appendEvent(
              transaction,
              jobId,
              "cancel_requested",
              {},
              now,
            );
          }
        }
        return get(jobId);
      });
    },
    succeed(claim, result) {
      const now = clock().toISOString();
      return connection.unitOfWork.run((transaction) => {
        if (
          commitRequestedCancellation(
            transaction,
            claim,
            now,
          )
        ) {
          return true;
        }
        const update = transaction.client
          .prepare(
            `UPDATE jobs
             SET status = 'succeeded',
                 progress = 100,
                 result_json = ?,
                 error_json = NULL,
                 lease_owner = NULL,
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 finished_at = ?,
                 updated_at = ?
             WHERE id = ?
               AND status = 'running'
               AND lease_token = ?
               AND cancel_requested_at IS NULL`,
          )
          .run(
            serializeJson(result),
            now,
            now,
            claim.record.id,
            claim.leaseToken,
          );
        if (Number(update.changes) !== 1) {
          return false;
        }
        appendEvent(
          transaction,
          claim.record.id,
          "succeeded",
          { result },
          now,
        );
        return true;
      });
    },
  };
}
