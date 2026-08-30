import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const projectCatalogState = sqliteTable(
  "project_catalog_state",
  {
    id: integer("id").notNull().primaryKey(),
    version: integer("version").notNull(),
  },
  (table) => [
    check(
      "project_catalog_state_singleton_check",
      sql`${table.id} = 1`,
    ),
    check(
      "project_catalog_state_version_check",
      sql`${table.version} >= 0`,
    ),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").notNull().primaryKey(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    genre: text("genre").notNull(),
    premise: text("premise").notNull(),
    targetAudience: text("target_audience").notNull(),
    targetWordCount: integer("target_word_count").notNull(),
    status: text("status", {
      enum: [
        "planning",
        "writing",
        "revising",
        "completed",
        "archived",
      ],
    }).notNull(),
    archivedFromStatus: text("archived_from_status", {
      enum: ["planning", "writing", "revising", "completed"],
    }),
    version: integer("version").notNull(),
    projectSequence: integer("project_sequence").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("projects_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    index("projects_active_updated_id_idx")
      .on(sql`${table.updatedAt} DESC`, table.id)
      .where(sql`${table.status} <> 'archived'`),
    index("projects_genre_idx").on(table.genre),
    check(
      "projects_title_length_check",
      sql`length(trim(${table.title})) BETWEEN 1 AND 80`,
    ),
    check(
      "projects_subtitle_length_check",
      sql`${table.subtitle} IS NULL OR length(trim(${table.subtitle})) BETWEEN 1 AND 120`,
    ),
    check(
      "projects_genre_length_check",
      sql`length(trim(${table.genre})) BETWEEN 1 AND 40`,
    ),
    check(
      "projects_premise_length_check",
      sql`length(trim(${table.premise})) BETWEEN 1 AND 2000`,
    ),
    check(
      "projects_target_audience_length_check",
      sql`length(trim(${table.targetAudience})) BETWEEN 1 AND 200`,
    ),
    check(
      "projects_target_word_count_check",
      sql`${table.targetWordCount} BETWEEN 1000 AND 10000000`,
    ),
    check(
      "projects_status_check",
      sql`${table.status} IN ('planning', 'writing', 'revising', 'completed', 'archived')`,
    ),
    check(
      "projects_archive_state_check",
      sql`(
        ${table.status} = 'archived'
        AND ${table.archivedFromStatus} IN ('planning', 'writing', 'revising', 'completed')
      ) OR (
        ${table.status} <> 'archived'
        AND ${table.archivedFromStatus} IS NULL
      )`,
    ),
    check(
      "projects_version_check",
      sql`${table.version} > 0`,
    ),
    check(
      "projects_sequence_check",
      sql`${table.projectSequence} > 0`,
    ),
  ],
);

export const projectModelPreferences = sqliteTable(
  "project_model_preferences",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role", {
      enum: ["chat", "writing", "review", "embedding"],
    }).notNull(),
    modelId: text("model_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.role],
      name: "project_model_preferences_pk",
    }),
    check(
      "project_model_preferences_role_check",
      sql`${table.role} IN ('chat', 'writing', 'review', 'embedding')`,
    ),
    check(
      "project_model_preferences_model_length_check",
      sql`length(trim(${table.modelId})) BETWEEN 1 AND 160`,
    ),
  ],
);

export const projectSchema = {
  projectCatalogState,
  projectModelPreferences,
  projects,
} as const;
