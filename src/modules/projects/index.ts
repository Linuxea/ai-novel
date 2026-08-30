import type { ModuleEntrypoint } from "@/shared/contracts";

export const projectsModule = {
  name: "projects",
  publicPath: "@/modules/projects",
} as const satisfies ModuleEntrypoint<"projects">;

export {
  ProjectCommandContextSchema,
  ProjectListInputSchema,
  TransitionProjectCommandSchema,
  UpdateProjectCommandSchema,
  VersionedProjectCommandSchema,
  createProjectsApplication,
} from "./application/projects-application";
export type {
  CreateProjectsApplicationDependencies,
  ProjectApplicationResult,
  ProjectCommandContext,
  ProjectListInput,
  ProjectMutationResult,
  ProjectsApplication,
  TransitionProjectCommand,
  UpdateProjectCommand,
  VersionedProjectCommand,
} from "./application/projects-application";
export type {
  ProjectEventOutbox,
  ProjectListFilter,
  ProjectPage,
  ProjectRepository,
  ProjectTransaction,
  ProjectUnitOfWork,
} from "./application/ports";
export {
  ActiveProjectStatusSchema,
  NovelProjectSchema,
  ProjectCreateInputSchema,
  ProjectIdSchema,
  ProjectModelPreferencesSchema,
  ProjectStatusSchema,
  ProjectUpdatePatchSchema,
} from "./domain/project";
export type {
  ActiveProjectStatus,
  NovelProject,
  ProjectCreateInput,
  ProjectId,
  ProjectModelPreferences,
  ProjectStatus,
  ProjectUpdatePatch,
} from "./domain/project";
export { getProjectsApplication } from "./infrastructure/composition";
export {
  ProjectApiErrorResponseSchema,
  ProjectApiListQuerySchema,
  ProjectApiPatchRequestSchema,
  ProjectApiVersionRequestSchema,
  ProjectCreateRequestSchema,
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
} from "./ui/api-contracts";
export type {
  ProjectApiPatchRequest,
  ProjectApiVersionRequest,
} from "./ui/api-contracts";
export { ProjectStudio } from "./ui/project-studio";
export { ProjectsWorkbench } from "./ui/projects-workbench";
