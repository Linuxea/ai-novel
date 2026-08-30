import type {
  JobClaim,
  JobRecord,
  JobRepository,
} from "./job-repository";
import {
  createIntervalLeaseHeartbeat,
  type LeaseHeartbeat,
} from "../lease-heartbeat";
import type {
  JobCatalog,
  JobCatalogPayload,
  JobCatalogResult,
} from "./job-catalog";

export interface JobDefinition {
  readonly payload: unknown;
  readonly result: unknown;
}

export type JobDefinitionMap = Record<string, JobDefinition>;

export type JobDefinitionsFromCatalog<
  TCatalog extends JobCatalog,
> = {
  readonly [TKey in keyof TCatalog]: {
    readonly payload: JobCatalogPayload<TCatalog, TKey>;
    readonly result: JobCatalogResult<TCatalog, TKey>;
  };
};

export interface JobHandlerContext<TPayload> {
  readonly attempt: number;
  readonly fencingToken: string;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly payload: TPayload;
  readonly signal: AbortSignal;
  isCancellationRequested(): boolean;
  reportProgress(
    progress: number,
    data?: Readonly<Record<string, unknown>>,
  ): void;
  throwIfCancelled(): void;
}

export type JobHandler<TPayload, TResult> = (
  context: JobHandlerContext<TPayload>,
) => TResult | Promise<TResult>;

export interface JobFailureClassification {
  readonly code: string;
  readonly retryable: boolean;
}

export interface JobCancellationWatcher {
  watch(
    jobId: string,
    onCancellation: () => void,
  ): () => void;
}

export interface CreateJobRunnerOptions<
  TCatalog extends JobCatalog = JobCatalog,
> {
  readonly backoff?: (
    attempt: number,
    error: unknown,
  ) => number;
  readonly classifyError?: (
    error: unknown,
    job: JobRecord,
  ) => JobFailureClassification;
  readonly cancellationWatcher?: JobCancellationWatcher;
  readonly catalog?: TCatalog;
  readonly heartbeat?: LeaseHeartbeat;
  readonly leaseDurationMs: number;
  readonly repository: JobRepository<TCatalog>;
  readonly workerId: string;
}

export interface JobRunner<
  TJobs extends JobDefinitionMap = JobDefinitionMap,
> {
  register<TKey extends keyof TJobs & string>(
    type: TKey,
    handler: JobHandler<
      TJobs[TKey]["payload"],
      TJobs[TKey]["result"]
    >,
  ): () => void;
  runOnce(signal?: AbortSignal): Promise<boolean>;
}

export class RetryableJobError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "RetryableJobError";
    this.code = code;
  }
}

export class FatalJobError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "FatalJobError";
    this.code = code;
  }
}

export class JobCancelledError extends Error {
  constructor(message = "任务已取消") {
    super(message);
    this.name = "JobCancelledError";
  }
}

function defaultBackoff(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

function defaultClassification(
  error: unknown,
): JobFailureClassification {
  if (error instanceof FatalJobError) {
    return { code: error.code, retryable: false };
  }
  if (error instanceof RetryableJobError) {
    return { code: error.code, retryable: true };
  }
  return { code: "job_handler_error", retryable: true };
}

export function createPollingJobCancellationWatcher(
  repository: JobRepository,
  intervalMs = 100,
): JobCancellationWatcher {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error("任务取消轮询间隔必须是正安全整数");
  }

  return {
    watch(jobId, onCancellation) {
      let stopped = false;
      const poll = () => {
        if (
          !stopped &&
          repository.isCancellationRequested(jobId)
        ) {
          onCancellation();
        }
      };
      poll();
      const handle = globalThis.setInterval(poll, intervalMs);
      handle.unref?.();
      return () => {
        if (stopped) {
          return;
        }
        stopped = true;
        globalThis.clearInterval(handle);
      };
    },
  };
}

export function createJobRunner<TCatalog extends JobCatalog>(
  options: CreateJobRunnerOptions<TCatalog> & {
    readonly catalog: TCatalog;
  },
): JobRunner<JobDefinitionsFromCatalog<TCatalog>>;
export function createJobRunner<
  TJobs extends JobDefinitionMap = JobDefinitionMap,
>(
  options: CreateJobRunnerOptions,
): JobRunner<TJobs>;
export function createJobRunner(
  options: CreateJobRunnerOptions,
): JobRunner {
  const handlers = new Map<
    string,
    JobHandler<unknown, unknown>
  >();
  const backoff = options.backoff ?? defaultBackoff;
  const classifyError =
    options.classifyError ??
    ((error: unknown) => defaultClassification(error));
  const cancellationWatcher =
    options.cancellationWatcher ??
    createPollingJobCancellationWatcher(options.repository);
  const heartbeat =
    options.heartbeat ??
    createIntervalLeaseHeartbeat(
      Math.max(1, Math.floor(options.leaseDurationMs / 3)),
    );

  function createContext(
    claim: JobClaim,
    controller: AbortController,
  ): JobHandlerContext<unknown> {
    const checkCancellation = () => {
      const cancelled =
        options.repository.isCancellationRequested(
          claim.record.id,
        );
      if (cancelled && !controller.signal.aborted) {
        controller.abort(new JobCancelledError());
      }
      return cancelled;
    };

    return {
      attempt: claim.record.attempt,
      fencingToken: claim.leaseToken,
      idempotencyKey: claim.record.idempotencyKey,
      jobId: claim.record.id,
      payload: claim.record.payload,
      signal: controller.signal,
      isCancellationRequested: checkCancellation,
      reportProgress(progress, data) {
        if (checkCancellation()) {
          throw new JobCancelledError();
        }
        const updated = options.repository.reportProgress(
          claim,
          progress,
          data,
        );
        if (!updated) {
          throw new Error("任务进度写入失败，租约可能已失效");
        }
      },
      throwIfCancelled() {
        if (checkCancellation()) {
          throw new JobCancelledError();
        }
      },
    };
  }

  return {
    register(type, handler) {
      if (options.catalog && !options.catalog[type]) {
        throw new Error(
          `任务类型未在 JobCatalog 注册: ${type}`,
        );
      }
      if (handlers.has(type)) {
        throw new Error(`任务处理器已注册: ${type}`);
      }
      const untypedHandler =
        handler as unknown as JobHandler<unknown, unknown>;
      handlers.set(type, untypedHandler);
      let registered = true;

      return () => {
        if (!registered) {
          return;
        }
        registered = false;
        if (handlers.get(type) === untypedHandler) {
          handlers.delete(type);
        }
      };
    },
    async runOnce(externalSignal) {
      if (externalSignal?.aborted) {
        return false;
      }
      const types = [...handlers.keys()];
      if (types.length === 0) {
        return false;
      }
      const claim = options.repository.claimNext({
        leaseDurationMs: options.leaseDurationMs,
        types,
        workerId: options.workerId,
      });
      if (!claim) {
        return false;
      }

      const handler = handlers.get(claim.record.type);
      if (!handler) {
        options.repository.fail(
          claim,
          new FatalJobError(
            "handler_unregistered",
            "任务领取后处理器已取消注册",
          ),
          { retryable: false, retryDelayMs: 0 },
        );
        return true;
      }

      const definition = options.catalog?.[claim.record.type];
      const parsedPayload = definition?.payloadSchema.safeParse(
        claim.record.payload,
      );
      if (parsedPayload && !parsedPayload.success) {
        options.repository.fail(
          claim,
          new FatalJobError(
            "invalid_payload",
            "持久任务 payload 校验失败",
          ),
          { retryable: false, retryDelayMs: 0 },
        );
        return true;
      }
      const executableClaim: JobClaim = parsedPayload
        ? {
            ...claim,
            record: {
              ...claim.record,
              payload: parsedPayload.data,
            },
          }
        : claim;

      const controller = new AbortController();
      const context = createContext(
        executableClaim,
        controller,
      );
      let stopWatchingCancellation: () => void = () => undefined;
      let stopHeartbeat: () => void = () => undefined;
      let leaseLost = false;
      const abortFromExternal = () => {
        if (!controller.signal.aborted) {
          controller.abort(
            externalSignal?.reason ??
              new RetryableJobError("worker_stopped"),
          );
        }
      };
      externalSignal?.addEventListener(
        "abort",
        abortFromExternal,
        { once: true },
      );
      if (externalSignal?.aborted) {
        abortFromExternal();
      }
      try {
        stopWatchingCancellation = cancellationWatcher.watch(
          claim.record.id,
          () => {
            if (!controller.signal.aborted) {
              controller.abort(new JobCancelledError());
            }
          },
        );
        stopHeartbeat = heartbeat.start({
          onLeaseLost() {
            leaseLost = true;
            if (!controller.signal.aborted) {
              controller.abort(
                new FatalJobError(
                  "lease_lost",
                  "任务租约已丢失",
                ),
              );
            }
          },
          renewLease: () =>
            options.repository.renewLease(
              claim,
              options.leaseDurationMs,
            ),
        });
        const handlerResult = await handler(context);
        const parsedResult = definition?.resultSchema.safeParse(
          handlerResult,
        );
        if (parsedResult && !parsedResult.success) {
          throw new FatalJobError(
            "invalid_result",
            "任务结果校验失败",
          );
        }
        const result = parsedResult?.data ?? handlerResult;
        if (context.isCancellationRequested()) {
          if (
            !options.repository.acknowledgeCancellation(claim)
          ) {
            leaseLost = true;
          }
        } else if (
          !leaseLost &&
          !options.repository.succeed(claim, result)
        ) {
          leaseLost = true;
          if (!controller.signal.aborted) {
            controller.abort(
              new FatalJobError("lease_lost"),
            );
          }
        }
      } catch (error) {
        if (leaseLost) {
          return true;
        }
        if (
          error instanceof JobCancelledError ||
          context.isCancellationRequested()
        ) {
          if (
            !options.repository.acknowledgeCancellation(claim)
          ) {
            leaseLost = true;
          }
        } else {
          const classification = classifyError(
            error,
            claim.record,
          );
          const message =
            error instanceof Error
              ? error.message
              : "任务处理失败";
          const classifiedError = classification.retryable
            ? new RetryableJobError(
                classification.code,
                message,
              )
            : new FatalJobError(
                classification.code,
                message,
              );
          const failed = options.repository.fail(claim, classifiedError, {
            retryable: classification.retryable,
            retryDelayMs: classification.retryable
              ? backoff(claim.record.attempt, error)
              : 0,
          });
          if (!failed) {
            leaseLost = true;
          }
        }
      } finally {
        stopHeartbeat();
        stopWatchingCancellation();
        externalSignal?.removeEventListener(
          "abort",
          abortFromExternal,
        );
      }
      return true;
    },
  };
}
