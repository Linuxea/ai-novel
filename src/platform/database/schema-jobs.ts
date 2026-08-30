import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").notNull().primaryKey(),
    type: text("type").notNull(),
    payload: text("payload_json", { mode: "json" })
      .$type<unknown>()
      .notNull(),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    runAt: text("run_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    progress: integer("progress").notNull().default(0),
    result: text("result_json", { mode: "json" }).$type<unknown>(),
    error: text("error_json", { mode: "json" }).$type<unknown>(),
    cancelRequestedAt: text("cancel_requested_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    uniqueIndex("jobs_type_idempotency_unique").on(
      table.type,
      table.idempotencyKey,
    ),
    index("jobs_claim_idx").on(
      table.status,
      table.runAt,
      table.leaseExpiresAt,
    ),
    check(
      "jobs_status_check",
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
    check("jobs_attempt_check", sql`${table.attempt} >= 0`),
    check(
      "jobs_max_attempts_check",
      sql`${table.maxAttempts} > 0`,
    ),
    check(
      "jobs_progress_check",
      sql`${table.progress} BETWEEN 0 AND 100`,
    ),
  ],
);

export const jobEvents = sqliteTable(
  "job_events",
  {
    cursor: integer("cursor").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    data: text("data_json", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("job_events_job_cursor_idx").on(table.jobId, table.cursor),
  ],
);

export const jobSchema = {
  jobEvents,
  jobs,
} as const;
