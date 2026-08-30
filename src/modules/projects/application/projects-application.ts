import { z, ZodError } from "zod";
import {
  createEventEnvelope,
  type ApplicationError,
  type EventEnvelope,
  type Result,
} from "@/shared/contracts";
import {
  ActiveProjectStatusSchema,
  archiveNovelProject,
  createNovelProject,
  ProjectCreateInputSchema,
  ProjectDomainError,
  ProjectIdSchema,
  ProjectStatusSchema,
  ProjectUpdatePatchSchema,
  restoreNovelProject,
  transitionNovelProject,
  updateNovelProject,
  type NovelProject,
  type ProjectCreateInput,
  type ProjectStatus,
} from "../domain/project";
import type {
  ProjectEventOutbox,
  ProjectListFilter,
  ProjectPage,
  ProjectRepository,
  ProjectUnitOfWork,
} from "./ports";

const PositiveVersionSchema = z.number().int().positive().safe();

export const ProjectCommandContextSchema = z
  .object({
    actorId: z.string().trim().min(1).max(128).optional(),
    correlationId: z.string().trim().min(1).max(128),
  })
  .strict();

export const ProjectListInputSchema = z
  .object({
    genre: z.string().trim().min(1).max(40).optional(),
    includeArchived: z.boolean().optional().default(false),
    page: z.number().int().positive().safe().optional().default(1),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(50)
      .safe()
      .optional()
      .default(12),
    search: z.string().trim().min(1).max(200).optional(),
    status: ProjectStatusSchema.optional(),
  })
  .strict();

export const UpdateProjectCommandSchema = z
  .object({
    expectedVersion: PositiveVersionSchema,
    patch: ProjectUpdatePatchSchema,
    projectId: ProjectIdSchema,
  })
  .strict();

export const TransitionProjectCommandSchema = z
  .object({
    expectedVersion: PositiveVersionSchema,
    projectId: ProjectIdSchema,
    status: ActiveProjectStatusSchema,
  })
  .strict();

export const VersionedProjectCommandSchema = z
  .object({
    expectedVersion: PositiveVersionSchema,
    projectId: ProjectIdSchema,
  })
  .strict();

export type ProjectCommandContext = z.infer<
  typeof ProjectCommandContextSchema
>;
export type ProjectListInput = z.input<typeof ProjectListInputSchema>;
export type UpdateProjectCommand = z.input<
  typeof UpdateProjectCommandSchema
>;
export type TransitionProjectCommand = z.input<
  typeof TransitionProjectCommandSchema
>;
export type VersionedProjectCommand = z.input<
  typeof VersionedProjectCommandSchema
>;
export type ProjectApplicationResult<TValue> = Result<
  TValue,
  ApplicationError
>;
export type ProjectFailure = {
  readonly error: ApplicationError;
  readonly ok: false;
};
export type ProjectMutationResult =
  | {
      readonly catalogVersion: number;
      readonly ok: true;
      readonly value: NovelProject;
    }
  | ProjectFailure;

export interface ProjectsApplication {
  archiveProject(
    command: VersionedProjectCommand,
    context: ProjectCommandContext,
  ): ProjectMutationResult;
  createProject(
    input: ProjectCreateInput,
    context: ProjectCommandContext,
  ): ProjectMutationResult;
  getProject(
    projectId: string,
  ): ProjectApplicationResult<NovelProject>;
  listProjects(
    input?: ProjectListInput,
  ): ProjectApplicationResult<ProjectPage>;
  restoreProject(
    command: VersionedProjectCommand,
    context: ProjectCommandContext,
  ): ProjectMutationResult;
  transitionProject(
    command: TransitionProjectCommand,
    context: ProjectCommandContext,
  ): ProjectMutationResult;
  updateProject(
    command: UpdateProjectCommand,
    context: ProjectCommandContext,
  ): ProjectMutationResult;
}

export interface CreateProjectsApplicationDependencies {
  readonly causeIdGenerator?: () => string;
  readonly clock?: () => Date;
  readonly eventIdGenerator: () => string;
  readonly idGenerator: () => string;
  readonly onUnexpectedError?: (error: unknown, causeId: string) => void;
  readonly outbox: ProjectEventOutbox;
  readonly repository: ProjectRepository;
  readonly unitOfWork: ProjectUnitOfWork;
}

interface LoadedProject {
  readonly current: NovelProject;
  readonly expectedVersion: number;
}

function success<TValue>(value: TValue): ProjectApplicationResult<TValue> {
  return { ok: true, value };
}

function mutationSuccess(
  value: NovelProject,
  catalogVersion: number,
): ProjectMutationResult {
  return { catalogVersion, ok: true, value };
}

function failure(error: ApplicationError): ProjectFailure {
  return { error, ok: false };
}

function notFound(): ProjectFailure {
  return failure({
    code: "projects.not_found",
    kind: "not_found",
    message: "作品不存在",
    retryable: false,
  });
}

function versionConflict(
  expectedVersion: number,
  actualVersion: number,
): ProjectFailure {
  return failure({
    code: "projects.version_conflict",
    details: { actualVersion, expectedVersion },
    kind: "conflict",
    message: "作品已被其他操作更新，请刷新后重试",
    retryable: false,
  });
}

function validationFailure(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ProjectFailure {
  return failure({
    code,
    details,
    kind: "validation",
    message,
    retryable: false,
  });
}

function zodFailure(error: ZodError): ProjectFailure {
  return validationFailure(
    "projects.invalid_input",
    "作品信息不符合要求",
    {
      issues: error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map(String),
      })),
    },
  );
}

function eventMetadata(actorId?: string) {
  return actorId
    ? { actorId, schemaVersion: 1 }
    : { schemaVersion: 1 };
}

export function createProjectsApplication(
  dependencies: CreateProjectsApplicationDependencies,
): ProjectsApplication {
  const clock = dependencies.clock ?? (() => new Date());
  const causeIdGenerator =
    dependencies.causeIdGenerator ?? dependencies.eventIdGenerator;
  const onUnexpectedError =
    dependencies.onUnexpectedError ?? (() => undefined);

  function runSafely<TResult extends Result<unknown, ApplicationError>>(
    operation: () => TResult,
  ): TResult {
    try {
      return operation();
    } catch (error) {
      if (error instanceof ZodError) {
        return zodFailure(error) as TResult;
      }
      if (error instanceof ProjectDomainError) {
        return validationFailure(error.code, error.message) as TResult;
      }
      const causeId = causeIdGenerator();
      onUnexpectedError(error, causeId);
      return failure({
        causeId,
        code: "projects.internal",
        kind: "internal",
        message: "作品操作暂时无法完成",
        retryable: false,
      }) as TResult;
    }
  }

  function loadForWrite(
    projectId: string,
    expectedVersion: number,
  ):
    | { readonly ok: true; readonly value: LoadedProject }
    | { readonly ok: false; readonly error: ApplicationError } {
    const parsedId = ProjectIdSchema.parse(projectId);
    const parsedVersion = PositiveVersionSchema.parse(expectedVersion);
    const current = dependencies.repository.findById(parsedId);
    if (!current) {
      return notFound();
    }
    if (current.version !== parsedVersion) {
      return versionConflict(parsedVersion, current.version);
    }
    return {
      ok: true,
      value: { current, expectedVersion: parsedVersion },
    };
  }

  function commitUpdate(
    loaded: LoadedProject,
    project: NovelProject,
    envelope: EventEnvelope,
  ): ProjectMutationResult {
    return dependencies.unitOfWork.run((transaction) => {
      const catalogVersion = dependencies.repository.update(
        transaction,
        project,
        loaded.expectedVersion,
      );
      if (catalogVersion === false) {
        const actual =
          dependencies.repository.findById(project.id)?.version ??
          loaded.expectedVersion;
        return versionConflict(loaded.expectedVersion, actual);
      }
      dependencies.outbox.enqueue(transaction, envelope);
      return mutationSuccess(project, catalogVersion);
    });
  }

  function writeEvent<TPayload>(
    eventName: string,
    project: NovelProject,
    context: ProjectCommandContext,
    occurredAt: string,
    payload: TPayload,
  ): EventEnvelope<TPayload> {
    return createEventEnvelope({
      aggregate: {
        aggregateId: project.id,
        aggregateType: "project",
        module: "projects",
        version: project.version,
      },
      correlationId: context.correlationId,
      eventId: dependencies.eventIdGenerator(),
      eventName,
      metadata: eventMetadata(context.actorId),
      occurredAt,
      payload,
    });
  }

  return {
    archiveProject(commandInput, contextInput) {
      return runSafely(() => {
        const command = VersionedProjectCommandSchema.parse(commandInput);
        const context = ProjectCommandContextSchema.parse(contextInput);
        const loaded = loadForWrite(
          command.projectId,
          command.expectedVersion,
        );
        if (!loaded.ok) {
          return loaded;
        }
        const occurredAt = clock().toISOString();
        const project = archiveNovelProject(
          loaded.value.current,
          occurredAt,
        );
        return commitUpdate(
          loaded.value,
          project,
          writeEvent(
            "projects.project.archived.v1",
            project,
            context,
            occurredAt,
            {
              archivedFromStatus:
                project.archivedFromStatus as Exclude<
                  ProjectStatus,
                  "archived"
                >,
              projectId: project.id,
            },
          ),
        );
      });
    },
    createProject(input, contextInput) {
      return runSafely(() => {
        const parsedInput = ProjectCreateInputSchema.parse(input);
        const context = ProjectCommandContextSchema.parse(contextInput);
        const occurredAt = clock().toISOString();
        const project = createNovelProject(parsedInput, {
          id: dependencies.idGenerator(),
          now: occurredAt,
        });
        const envelope = writeEvent(
          "projects.project.created.v1",
          project,
          context,
          occurredAt,
          {
            projectId: project.id,
            status: project.status,
          },
        );
        return dependencies.unitOfWork.run((transaction) => {
          const catalogVersion = dependencies.repository.insert(
            transaction,
            project,
          );
          dependencies.outbox.enqueue(transaction, envelope);
          return mutationSuccess(project, catalogVersion);
        });
      });
    },
    getProject(projectId) {
      return runSafely(() => {
        const parsedId = ProjectIdSchema.parse(projectId);
        const project = dependencies.repository.findById(parsedId);
        return project ? success(project) : notFound();
      });
    },
    listProjects(input = {}) {
      return runSafely(() => {
        const filter = ProjectListInputSchema.parse(
          input,
        ) satisfies ProjectListFilter;
        return success(dependencies.repository.list(filter));
      });
    },
    restoreProject(commandInput, contextInput) {
      return runSafely(() => {
        const command = VersionedProjectCommandSchema.parse(commandInput);
        const context = ProjectCommandContextSchema.parse(contextInput);
        const loaded = loadForWrite(
          command.projectId,
          command.expectedVersion,
        );
        if (!loaded.ok) {
          return loaded;
        }
        const occurredAt = clock().toISOString();
        const project = restoreNovelProject(
          loaded.value.current,
          occurredAt,
        );
        return commitUpdate(
          loaded.value,
          project,
          writeEvent(
            "projects.project.restored.v1",
            project,
            context,
            occurredAt,
            {
              projectId: project.id,
              restoredStatus: project.status,
            },
          ),
        );
      });
    },
    transitionProject(commandInput, contextInput) {
      return runSafely(() => {
        const command =
          TransitionProjectCommandSchema.parse(commandInput);
        const context = ProjectCommandContextSchema.parse(contextInput);
        const loaded = loadForWrite(
          command.projectId,
          command.expectedVersion,
        );
        if (!loaded.ok) {
          return loaded;
        }
        const occurredAt = clock().toISOString();
        const project = transitionNovelProject(
          loaded.value.current,
          command.status,
          occurredAt,
        );
        return commitUpdate(
          loaded.value,
          project,
          writeEvent(
            "projects.project.status_changed.v1",
            project,
            context,
            occurredAt,
            {
              fromStatus: loaded.value.current.status,
              projectId: project.id,
              toStatus: project.status,
            },
          ),
        );
      });
    },
    updateProject(commandInput, contextInput) {
      return runSafely(() => {
        const command = UpdateProjectCommandSchema.parse(commandInput);
        const context = ProjectCommandContextSchema.parse(contextInput);
        const loaded = loadForWrite(
          command.projectId,
          command.expectedVersion,
        );
        if (!loaded.ok) {
          return loaded;
        }
        const occurredAt = clock().toISOString();
        const project = updateNovelProject(
          loaded.value.current,
          command.patch,
          occurredAt,
        );
        return commitUpdate(
          loaded.value,
          project,
          writeEvent(
            "projects.project.updated.v1",
            project,
            context,
            occurredAt,
            {
              changedFields: Object.keys(command.patch).sort(),
              projectId: project.id,
            },
          ),
        );
      });
    },
  };
}
