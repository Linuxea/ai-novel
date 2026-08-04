import "server-only";
import { z } from "zod";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type Project,
} from "@/lib/types";

type ProjectDocument = Record<string, unknown>;
type ProjectMigration = (document: ProjectDocument) => ProjectDocument;

export const PROJECT_MIGRATIONS: Readonly<Record<number, ProjectMigration>> = {
  0: (document) => ({ ...document, schemaVersion: 1 }),
};

export function migrateProjectDocument(input: unknown): {
  project: Project;
  migrated: boolean;
} {
  const document = z.record(z.string(), z.unknown()).parse(input);
  const rawVersion = document.schemaVersion ?? 0;
  if (
    typeof rawVersion !== "number" ||
    !Number.isInteger(rawVersion) ||
    rawVersion < 0
  ) {
    throw new Error("项目 schemaVersion 非法");
  }
  if (rawVersion > CURRENT_PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `项目 schemaVersion ${rawVersion} 高于当前支持版本 ${CURRENT_PROJECT_SCHEMA_VERSION}`,
    );
  }

  let version = rawVersion;
  let migrated = false;
  let current = document;
  while (version < CURRENT_PROJECT_SCHEMA_VERSION) {
    const migration = PROJECT_MIGRATIONS[version];
    if (!migration) throw new Error(`缺少项目 schema migration: ${version}`);
    current = migration(current);
    version++;
    migrated = true;
  }

  return { project: ProjectSchema.parse(current), migrated };
}
