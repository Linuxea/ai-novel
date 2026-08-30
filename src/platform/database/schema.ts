import { eventSchema } from "./schema-events";
import { jobSchema } from "./schema-jobs";
import { projectSchema } from "./schema-projects";

export const platformSchema = {
  ...eventSchema,
  ...jobSchema,
  ...projectSchema,
} as const;

export type PlatformSchema = typeof platformSchema;

export { domainEvents, eventSchema } from "./schema-events";
export { jobEvents, jobs, jobSchema } from "./schema-jobs";
export {
  projectCatalogState,
  projectModelPreferences,
  projects,
  projectSchema,
} from "./schema-projects";
