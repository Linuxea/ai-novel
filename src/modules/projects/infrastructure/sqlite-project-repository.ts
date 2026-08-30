import type { UnitOfWorkContext } from "@/platform/database";
import type { SqliteDatabaseConnection } from "@/platform/database";
import {
  NovelProjectSchema,
  ProjectStatusSchema,
  type NovelProject,
  type ProjectModelPreferences,
} from "../domain/project";
import type {
  ProjectListFilter,
  ProjectPage,
  ProjectRepository,
  ProjectTransaction,
} from "../application/ports";

interface ProjectRow {
  readonly archived_from_status: string | null;
  readonly created_at: string;
  readonly genre: string;
  readonly id: string;
  readonly premise: string;
  readonly project_sequence: number;
  readonly status: string;
  readonly subtitle: string | null;
  readonly target_audience: string;
  readonly target_word_count: number;
  readonly title: string;
  readonly updated_at: string;
  readonly version: number;
}

interface JoinedProjectRow extends ProjectRow {
  readonly preference_model_id: string | null;
  readonly preference_role: string | null;
}

type NullableProjectRow = {
  readonly [Key in keyof ProjectRow]: ProjectRow[Key] | null;
};

type ProjectListQueryRow = NullableProjectRow & {
  readonly catalog_version: number;
  readonly fetched_at: number;
  readonly preference_model_id: string | null;
  readonly preference_role: string | null;
  readonly total: number;
};

const MODEL_ROLES = [
  "chat",
  "writing",
  "review",
  "embedding",
] as const;

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label}必须是正安全整数`);
  }
  return value;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll(
    "_",
    "\\_",
  );
}

export function createSqliteProjectRepository(
  connection: SqliteDatabaseConnection,
): ProjectRepository {
  function requireTransaction(
    transaction: ProjectTransaction,
  ): UnitOfWorkContext {
    if (
      typeof transaction.resource !== "object" ||
      transaction.resource === null ||
      !("client" in transaction.resource) ||
      !("database" in transaction.resource)
    ) {
      throw new Error("项目仓储需要有效的 UnitOfWork 上下文");
    }
    const resource = transaction.resource as UnitOfWorkContext;
    if (
      resource.client !== connection.client ||
      !resource.client.isTransaction
    ) {
      throw new Error("项目写入必须在所属 UnitOfWork 内执行");
    }
    return resource;
  }

  function emptyPreferences(): ProjectModelPreferences {
    return {
      chat: null,
      embedding: null,
      review: null,
      writing: null,
    };
  }

  function applyPreference(
    preferences: ProjectModelPreferences,
    role: string | null,
    modelId: string | null,
  ): void {
    if (role === null && modelId === null) {
      return;
    }
    if (
      role === null ||
      modelId === null ||
      !MODEL_ROLES.includes(role as (typeof MODEL_ROLES)[number])
    ) {
      throw new Error(`未知项目模型角色: ${role ?? "null"}`);
    }
    preferences[role as (typeof MODEL_ROLES)[number]] = modelId;
  }

  function mapJoinedRows(
    rows: readonly JoinedProjectRow[],
  ): NovelProject[] {
    const projectsById = new Map<
      string,
      {
        readonly preferences: ProjectModelPreferences;
        readonly row: ProjectRow;
      }
    >();
    for (const row of rows) {
      let entry = projectsById.get(row.id);
      if (!entry) {
        entry = {
          preferences: emptyPreferences(),
          row,
        };
        projectsById.set(row.id, entry);
      }
      applyPreference(
        entry.preferences,
        row.preference_role,
        row.preference_model_id,
      );
    }
    return [...projectsById.values()].map(({ preferences, row }) =>
      mapRow(row, preferences),
    );
  }

  function mapRow(
    row: ProjectRow,
    modelPreferences: ProjectModelPreferences,
  ): NovelProject {
    const preferences: ProjectModelPreferences = {
      ...modelPreferences,
    };
    return NovelProjectSchema.parse({
      archivedFromStatus: row.archived_from_status,
      createdAt: row.created_at,
      genre: row.genre,
      id: row.id,
      modelPreferences: preferences,
      premise: row.premise,
      projectSequence: row.project_sequence,
      status: row.status,
      subtitle: row.subtitle,
      targetAudience: row.target_audience,
      targetWordCount: row.target_word_count,
      title: row.title,
      updatedAt: row.updated_at,
      version: row.version,
    });
  }

  function insertPreferences(
    resource: UnitOfWorkContext,
    project: NovelProject,
  ): void {
    const statement = resource.client.prepare(
      "INSERT INTO project_model_preferences (project_id, role, model_id) VALUES (?, ?, ?)",
    );
    for (const role of MODEL_ROLES) {
      const modelId = project.modelPreferences[role];
      if (modelId !== null) {
        statement.run(project.id, role, modelId);
      }
    }
  }

  function writeProject(
    resource: UnitOfWorkContext,
    project: NovelProject,
  ): void {
    resource.client
      .prepare(
        `INSERT INTO projects (
          id, title, subtitle, genre, premise, target_audience,
          target_word_count, status, archived_from_status, version,
          project_sequence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.title,
        project.subtitle,
        project.genre,
        project.premise,
        project.targetAudience,
        project.targetWordCount,
        project.status,
        project.archivedFromStatus,
        project.version,
        project.projectSequence,
        project.createdAt,
        project.updatedAt,
      );
    insertPreferences(resource, project);
  }

  function bumpCatalogVersion(resource: UnitOfWorkContext): number {
    const row = resource.client
      .prepare(
        `UPDATE project_catalog_state
         SET version = version + 1
         WHERE id = 1
         RETURNING version`,
      )
      .get() as { version: number } | undefined;
    if (!row) {
      throw new Error("项目目录版本状态不存在");
    }
    return Number(row.version);
  }

  return {
    findById(projectId) {
      const rows = connection.client
        .prepare(
          `SELECT
             p.*,
             preferences.role AS preference_role,
             preferences.model_id AS preference_model_id
           FROM projects p
           LEFT JOIN project_model_preferences preferences
             ON preferences.project_id = p.id
           WHERE p.id = ?
           ORDER BY preferences.role ASC`,
        )
        .all(projectId) as unknown as JoinedProjectRow[];
      return mapJoinedRows(rows)[0];
    },
    insert(transaction, inputProject) {
      const resource = requireTransaction(transaction);
      const project = NovelProjectSchema.parse(inputProject);
      writeProject(resource, project);
      return bumpCatalogVersion(resource);
    },
    list(filter: ProjectListFilter): ProjectPage {
      const page = requirePositiveInteger(filter.page, "页码");
      const pageSize = requirePositiveInteger(filter.pageSize, "每页数量");
      const clauses: string[] = [];
      const parameters: Array<number | string> = [];
      if (filter.status) {
        clauses.push("p.status = ?");
        parameters.push(ProjectStatusSchema.parse(filter.status));
      } else if (!filter.includeArchived) {
        clauses.push("p.status <> 'archived'");
      }
      const genre = filter.genre?.trim();
      if (genre) {
        clauses.push("p.genre = ?");
        parameters.push(genre);
      }
      const search = filter.search?.trim();
      if (search) {
        const term = `%${escapeLike(search)}%`;
        clauses.push(
          "(p.title LIKE ? ESCAPE '\\' OR p.subtitle LIKE ? ESCAPE '\\' OR p.premise LIKE ? ESCAPE '\\')",
        );
        parameters.push(term, term, term);
      }
      const where =
        clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
      const rows = connection.client
        .prepare(
          `WITH filtered AS (
             SELECT p.*
             FROM projects p${where}
           ),
           paged AS (
             SELECT *
             FROM filtered
             ORDER BY updated_at DESC, id ASC
             LIMIT ? OFFSET ?
           ),
           totals AS (
             SELECT count(*) AS total FROM filtered
           ),
           catalog AS (
             SELECT version FROM project_catalog_state WHERE id = 1
           )
           SELECT
             catalog.version AS catalog_version,
             CAST(unixepoch('subsec') * 1000 AS INTEGER) AS fetched_at,
             totals.total,
             paged.*,
             preferences.role AS preference_role,
             preferences.model_id AS preference_model_id
           FROM totals
           CROSS JOIN catalog
           LEFT JOIN paged ON 1 = 1
           LEFT JOIN project_model_preferences preferences
             ON preferences.project_id = paged.id
           ORDER BY paged.updated_at DESC, paged.id ASC, preferences.role ASC`,
        )
        .all(
          ...parameters,
          pageSize,
          (page - 1) * pageSize,
        ) as unknown as ProjectListQueryRow[];
      const total = Number(rows[0]?.total ?? 0);
      const projectRows = rows.filter(
        (
          row,
        ): row is ProjectListQueryRow & JoinedProjectRow =>
          row.id !== null,
      );
      return {
        catalogVersion: Number(rows[0]?.catalog_version ?? 0),
        fetchedAt: Number(rows[0]?.fetched_at ?? 0),
        items: mapJoinedRows(projectRows),
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      };
    },
    update(transaction, inputProject, expectedVersion) {
      const resource = requireTransaction(transaction);
      const project = NovelProjectSchema.parse(inputProject);
      requirePositiveInteger(expectedVersion, "预期版本");
      if (
        project.version !== expectedVersion + 1 ||
        project.projectSequence < 2
      ) {
        return false;
      }
      const result = resource.client
        .prepare(
          `UPDATE projects
           SET title = ?, subtitle = ?, genre = ?, premise = ?,
               target_audience = ?, target_word_count = ?, status = ?,
               archived_from_status = ?, version = ?,
               project_sequence = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          project.title,
          project.subtitle,
          project.genre,
          project.premise,
          project.targetAudience,
          project.targetWordCount,
          project.status,
          project.archivedFromStatus,
          project.version,
          project.projectSequence,
          project.updatedAt,
          project.id,
          expectedVersion,
        );
      if (Number(result.changes) !== 1) {
        return false;
      }
      resource.client
        .prepare(
          "DELETE FROM project_model_preferences WHERE project_id = ?",
        )
        .run(project.id);
      insertPreferences(resource, project);
      return bumpCatalogVersion(resource);
    },
  };
}
