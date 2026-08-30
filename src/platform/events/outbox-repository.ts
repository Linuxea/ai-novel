import { randomUUID } from "node:crypto";
import type {
  EventEnvelope,
  EventEnvelopeInput,
} from "@/shared/contracts";
import { createEventEnvelope } from "@/shared/contracts";
import type {
  SqliteDatabaseConnection,
  UnitOfWorkContext,
} from "@/platform/database";
import {
  sanitizeSensitiveString,
  serializeSafeError,
} from "@/platform/observability";

export type OutboxStatus =
  | "pending"
  | "processing"
  | "published"
  | "failed";

export interface OutboxRecord {
  readonly attempts: number;
  readonly availableAt?: string;
  readonly createdAt: string;
  readonly envelope: EventEnvelope;
  readonly failedAt?: string;
  readonly failureCode?: string;
  readonly id: string;
  readonly lastError?: string;
  readonly leaseExpiresAt?: string;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly maxAttempts: number;
  readonly publishedAt?: string;
  readonly status: OutboxStatus;
  readonly updatedAt: string;
}

export interface OutboxClaim {
  readonly leaseToken: string;
  readonly record: OutboxRecord;
}

export interface EnqueueEventOptions {
  readonly availableAt?: Date;
  readonly maxAttempts?: number;
}

export interface ClaimOutboxOptions {
  readonly eventNames?: readonly string[];
  readonly leaseDurationMs: number;
  readonly workerId: string;
}

export interface FailOutboxClaimOptions {
  readonly backoffMs: number;
  readonly error: unknown;
  readonly failureCode: string;
  readonly now?: Date;
}

export interface OutboxRepositoryOptions {
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly leaseTokenGenerator?: () => string;
}

export interface OutboxRepository {
  claimNext(options: ClaimOutboxOptions): OutboxClaim | undefined;
  enqueue(
    transaction: UnitOfWorkContext,
    envelope: EventEnvelope,
    options?: EnqueueEventOptions,
  ): OutboxRecord;
  failClaim(
    claim: OutboxClaim,
    options: FailOutboxClaimOptions,
  ): boolean;
  getByEventId(eventId: string): OutboxRecord | undefined;
  markPublished(claim: OutboxClaim, now?: Date): boolean;
  renewLease(claim: OutboxClaim, leaseDurationMs: number): boolean;
}

interface OutboxRow {
  readonly attempts: number;
  readonly available_at: string | null;
  readonly created_at: string;
  readonly envelope_json: string;
  readonly failed_at: string | null;
  readonly failure_code: string | null;
  readonly id: string;
  readonly last_error: string | null;
  readonly lease_expires_at: string | null;
  readonly lease_owner: string | null;
  readonly lease_token: string | null;
  readonly max_attempts: number;
  readonly published_at: string | null;
  readonly status: string;
  readonly updated_at: string;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} 必须是正安全整数`);
  }
  return value;
}

function optionalString(value: string | null): string | undefined {
  return value ?? undefined;
}

function parseStatus(value: string): OutboxStatus {
  if (
    value === "pending" ||
    value === "processing" ||
    value === "published" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`未知 outbox 状态: ${value}`);
}

function parseEnvelope(value: string): EventEnvelope {
  const input = JSON.parse(value) as EventEnvelopeInput;
  return createEventEnvelope(input);
}

function mapOutboxRow(row: OutboxRow): OutboxRecord {
  return {
    attempts: row.attempts,
    availableAt: optionalString(row.available_at),
    createdAt: row.created_at,
    envelope: parseEnvelope(row.envelope_json),
    failedAt: optionalString(row.failed_at),
    failureCode: optionalString(row.failure_code),
    id: row.id,
    lastError: optionalString(row.last_error),
    leaseExpiresAt: optionalString(row.lease_expires_at),
    leaseOwner: optionalString(row.lease_owner),
    leaseToken: optionalString(row.lease_token),
    maxAttempts: row.max_attempts,
    publishedAt: optionalString(row.published_at),
    status: parseStatus(row.status),
    updatedAt: row.updated_at,
  };
}

function errorMessage(error: unknown): string {
  return serializeSafeError(error).message;
}

export function createOutboxRepository(
  connection: SqliteDatabaseConnection,
  options: OutboxRepositoryOptions = {},
): OutboxRepository {
  const clock = options.clock ?? (() => new Date());
  const idGenerator = options.idGenerator ?? randomUUID;
  const leaseTokenGenerator =
    options.leaseTokenGenerator ?? randomUUID;

  function getByEventId(eventId: string): OutboxRecord | undefined {
    const row = connection.client
      .prepare("SELECT * FROM domain_events WHERE event_id = ?")
      .get(eventId) as unknown as OutboxRow | undefined;
    return row ? mapOutboxRow(row) : undefined;
  }

  return {
    claimNext(claimOptions) {
      const leaseDurationMs = requirePositiveInteger(
        claimOptions.leaseDurationMs,
        "事件租约时长",
      );
      if (!claimOptions.workerId.trim()) {
        throw new Error("事件工作器标识不能为空");
      }
      const eventNames = claimOptions.eventNames?.map((eventName) => {
        const normalized = eventName.trim();
        if (!normalized) {
          throw new Error("可领取事件名不能为空");
        }
        return normalized;
      });
      if (eventNames?.length === 0) {
        return undefined;
      }
      const eventNameFilter = eventNames
        ? ` AND event_name IN (${eventNames
            .map(() => "?")
            .join(", ")})`
        : "";
      const now = clock();
      const nowIso = now.toISOString();
      const leaseExpiresAt = new Date(
        now.getTime() + leaseDurationMs,
      ).toISOString();
      const leaseToken = leaseTokenGenerator();

      return connection.unitOfWork.run(() => {
        connection.client
          .prepare(
            `UPDATE domain_events
             SET status = 'failed',
                 available_at = NULL,
                 lease_owner = NULL,
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 failed_at = ?,
                 failure_code = 'lease_expired',
                 last_error = '事件处理租约过期且已耗尽最大尝试次数',
                 updated_at = ?
             WHERE status = 'processing'
               AND lease_expires_at <= ?
               AND attempts >= max_attempts
               ${eventNameFilter}`,
          )
          .run(
            nowIso,
            nowIso,
            nowIso,
            ...(eventNames ?? []),
          );

        const row = connection.client
          .prepare(
            `UPDATE domain_events
             SET status = 'processing',
                 attempts = attempts + 1,
                 lease_owner = ?,
                 lease_token = ?,
                 lease_expires_at = ?,
                 updated_at = ?
             WHERE id = (
               SELECT id
               FROM domain_events
               WHERE (
                 (status = 'pending' AND available_at <= ?)
                 OR (status = 'processing' AND lease_expires_at <= ?)
               )
               AND attempts < max_attempts
               ${eventNameFilter}
               ORDER BY created_at, id
               LIMIT 1
             )
             RETURNING *`,
          )
          .get(
            claimOptions.workerId,
            leaseToken,
            leaseExpiresAt,
            nowIso,
            nowIso,
            nowIso,
            ...(eventNames ?? []),
          ) as unknown as OutboxRow | undefined;

        if (!row) {
          return undefined;
        }
        return {
          leaseToken,
          record: mapOutboxRow(row),
        };
      });
    },
    enqueue(transaction, envelope, enqueueOptions = {}) {
      if (
        transaction.client !== connection.client ||
        !transaction.client.isTransaction
      ) {
        throw new Error("outbox 事件必须在所属 Unit of Work 内写入");
      }
      const maxAttempts = requirePositiveInteger(
        enqueueOptions.maxAttempts ?? 5,
        "事件最大尝试次数",
      );
      const now = clock().toISOString();
      const availableAt = (
        enqueueOptions.availableAt ?? new Date(now)
      ).toISOString();
      const id = idGenerator();

      transaction.client
        .prepare(
          `INSERT INTO domain_events (
             id, event_id, event_name, envelope_json, status,
             attempts, max_attempts, available_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
        )
        .run(
          id,
          envelope.eventId,
          envelope.eventName,
          JSON.stringify(envelope),
          maxAttempts,
          availableAt,
          now,
          now,
        );

      const record = getByEventId(envelope.eventId);
      if (!record) {
        throw new Error("outbox 事件写入后无法读取");
      }
      return record;
    },
    failClaim(claim, failOptions) {
      const backoffMs = requirePositiveInteger(
        failOptions.backoffMs,
        "事件退避时长",
      );
      const now = failOptions.now ?? clock();
      const terminal =
        claim.record.attempts >= claim.record.maxAttempts;
      const availableAt = terminal
        ? null
        : new Date(now.getTime() + backoffMs).toISOString();
      const result = connection.client
        .prepare(
          `UPDATE domain_events
           SET status = ?,
               available_at = ?,
               lease_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL,
               failed_at = ?,
               failure_code = ?,
               last_error = ?,
               updated_at = ?
           WHERE id = ?
             AND status = 'processing'
             AND lease_token = ?`,
        )
        .run(
          terminal ? "failed" : "pending",
          availableAt,
          terminal ? now.toISOString() : null,
          terminal
            ? sanitizeSensitiveString(
                failOptions.failureCode,
                256,
              )
            : null,
          errorMessage(failOptions.error),
          now.toISOString(),
          claim.record.id,
          claim.leaseToken,
        );
      return Number(result.changes) === 1;
    },
    getByEventId,
    markPublished(claim, publishedAt = clock()) {
      const timestamp = publishedAt.toISOString();
      const result = connection.client
        .prepare(
          `UPDATE domain_events
           SET status = 'published',
               available_at = NULL,
               lease_owner = NULL,
               lease_token = NULL,
               lease_expires_at = NULL,
               published_at = ?,
               failed_at = NULL,
               failure_code = NULL,
               updated_at = ?
           WHERE id = ?
             AND status = 'processing'
             AND lease_token = ?`,
        )
        .run(
          timestamp,
          timestamp,
          claim.record.id,
          claim.leaseToken,
        );
      return Number(result.changes) === 1;
    },
    renewLease(claim, leaseDurationMs) {
      const duration = requirePositiveInteger(
        leaseDurationMs,
        "事件租约时长",
      );
      const now = clock();
      const nowIso = now.toISOString();
      const leaseExpiresAt = new Date(
        now.getTime() + duration,
      ).toISOString();
      const result = connection.client
        .prepare(
          `UPDATE domain_events
           SET lease_expires_at = ?, updated_at = ?
           WHERE id = ?
             AND status = 'processing'
             AND lease_token = ?
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
  };
}
