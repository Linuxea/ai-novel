import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { EventEnvelope } from "@/shared/contracts";

export const domainEvents = sqliteTable(
  "domain_events",
  {
    id: text("id").notNull().primaryKey(),
    eventId: text("event_id").notNull(),
    eventName: text("event_name").notNull(),
    envelope: text("envelope_json", { mode: "json" })
      .$type<EventEnvelope>()
      .notNull(),
    status: text("status", {
      enum: ["pending", "processing", "published", "failed"],
    }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    availableAt: text("available_at"),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    publishedAt: text("published_at"),
    failedAt: text("failed_at"),
    failureCode: text("failure_code"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("domain_events_event_id_unique").on(table.eventId),
    index("domain_events_dispatch_idx").on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    check(
      "domain_events_status_check",
      sql`${table.status} IN ('pending', 'processing', 'published', 'failed')`,
    ),
    check(
      "domain_events_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "domain_events_max_attempts_check",
      sql`${table.maxAttempts} > 0`,
    ),
  ],
);

export const eventSchema = {
  domainEvents,
} as const;
