import type { PlatformEntrypoint } from "../capabilities";

export const jobsPlatform = {
  name: "jobs",
  publicPath: "@/platform/jobs",
} as const satisfies PlatformEntrypoint<"jobs">;

export {
  FatalJobError,
  JobCancelledError,
  RetryableJobError,
  createJobRunner,
  createPollingJobCancellationWatcher,
} from "./job-runner";
export type {
  CreateJobRunnerOptions,
  JobCancellationWatcher,
  JobDefinition,
  JobDefinitionMap,
  JobFailureClassification,
  JobHandler,
  JobHandlerContext,
  JobRunner,
  JobDefinitionsFromCatalog,
} from "./job-runner";
export {
  JobPayloadCompatibilityError,
  JobPayloadSerializationError,
  defineJobCatalog,
} from "./job-catalog";
export type {
  JobCatalog,
  JobCatalogEntry,
  JobCatalogInput,
  JobCatalogPayload,
  JobCatalogResult,
} from "./job-catalog";
export { createJobRepository } from "./job-repository";
export type {
  ClaimJobOptions,
  EnqueueJobInput,
  FailJobOptions,
  JobClaim,
  JobEvent,
  JobRecord,
  JobRepository,
  JobRepositoryOptions,
  JobStatus,
  ListJobEventsOptions,
} from "./job-repository";
export {
  createIntervalLeaseHeartbeat,
} from "../lease-heartbeat";
export {
  createPlatformWorkerRuntime,
  getPlatformWorkerState,
  startPlatformWorkers,
  stopPlatformWorkers,
} from "./runtime-workers";
export type {
  CreateIntervalLeaseHeartbeatOptions,
  LeaseHeartbeat,
  LeaseHeartbeatScheduler,
  LeaseHeartbeatStartOptions,
  LeaseHeartbeatTimerHandle,
} from "../lease-heartbeat";
export type {
  PlatformWorkerRuntime,
  PlatformWorkerState,
  StartPlatformWorkersOptions,
  WorkerLoopRuntime,
  WorkerScheduler,
  WorkerTimerHandle,
} from "./runtime-workers";
