import {
  closeDatabaseSingleton,
  getDatabaseSingleton,
} from "@/platform/database";
import {
  createEventBus,
  createOutboxDispatcher,
  createOutboxRepository,
  type EventBus,
  type EventMap,
  type OutboxRepository,
} from "@/platform/events";
import {
  createLogger,
  type Logger,
} from "@/platform/observability";
import {
  createJobRunner,
  type JobDefinitionMap,
  type JobRunner,
} from "./job-runner";
import {
  createJobRepository,
  type JobRepository,
} from "./job-repository";

const WORKER_STATE_SYMBOL = Symbol.for(
  "ai-novel.platform.worker-state",
);

export interface WorkerTimerHandle {
  unref?(): void;
}

export interface WorkerScheduler {
  clearInterval(handle: WorkerTimerHandle): void;
  setInterval(
    callback: () => void,
    intervalMs: number,
  ): WorkerTimerHandle;
}

export interface WorkerLoopRuntime {
  close(): Promise<void> | void;
  dispatchOutbox(signal: AbortSignal): Promise<boolean>;
  runJob(signal: AbortSignal): Promise<boolean>;
}

export interface PlatformWorkerRuntime extends WorkerLoopRuntime {
  readonly eventBus: EventBus<EventMap>;
  readonly jobRepository: JobRepository;
  readonly jobRunner: JobRunner<JobDefinitionMap>;
  readonly outboxRepository: OutboxRepository;
}

export interface StartPlatformWorkersOptions {
  readonly createRuntime?: () => WorkerLoopRuntime;
  readonly intervalMs?: number;
  readonly logger?: Logger;
  readonly scheduler?: WorkerScheduler;
}

export interface PlatformWorkerState {
  readonly runtime: WorkerLoopRuntime;
  readonly timers: readonly WorkerTimerHandle[];
  stop(): Promise<void>;
}

type WorkerGlobal = typeof globalThis & {
  [WORKER_STATE_SYMBOL]?: PlatformWorkerState;
};

const workerGlobal = globalThis as WorkerGlobal;

const defaultScheduler: WorkerScheduler = {
  clearInterval(handle) {
    globalThis.clearInterval(
      handle as ReturnType<typeof globalThis.setInterval>,
    );
  },
  setInterval(callback, intervalMs) {
    return globalThis.setInterval(
      callback,
      intervalMs,
    ) as unknown as WorkerTimerHandle;
  },
};

export function createPlatformWorkerRuntime(): PlatformWorkerRuntime {
  const connection = getDatabaseSingleton();
  const eventBus = createEventBus();
  const outboxRepository = createOutboxRepository(connection);
  const jobRepository = createJobRepository(connection);
  const outboxDispatcher = createOutboxDispatcher({
    bus: eventBus,
    leaseDurationMs: 30_000,
    repository: outboxRepository,
    workerId: `outbox-${process.pid}`,
  });
  const jobRunner = createJobRunner({
    leaseDurationMs: 30_000,
    repository: jobRepository,
    workerId: `jobs-${process.pid}`,
  });

  return {
    eventBus,
    jobRepository,
    jobRunner,
    outboxRepository,
    close: closeDatabaseSingleton,
    dispatchOutbox: (signal) =>
      outboxDispatcher.dispatchOnce(signal),
    runJob: (signal) => jobRunner.runOnce(signal),
  };
}

export function getPlatformWorkerState():
  | PlatformWorkerState
  | undefined {
  return workerGlobal[WORKER_STATE_SYMBOL];
}

export function startPlatformWorkers(
  options: StartPlatformWorkersOptions = {},
): PlatformWorkerState {
  const existing = getPlatformWorkerState();
  if (existing) {
    return existing;
  }

  const intervalMs = options.intervalMs ?? 1_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error("平台工作器轮询间隔必须是正安全整数");
  }

  const runtime =
    options.createRuntime?.() ?? createPlatformWorkerRuntime();
  const scheduler = options.scheduler ?? defaultScheduler;
  const logger = options.logger ?? createLogger();
  const timers: WorkerTimerHandle[] = [];
  const activeOperations = new Set<Promise<unknown>>();
  const shutdownController = new AbortController();
  let stopped = false;
  let stopPromise: Promise<void> | undefined;

  function schedule(
    name: string,
    operation: (signal: AbortSignal) => Promise<boolean>,
  ): void {
    let active = false;
    const handle = scheduler.setInterval(() => {
      if (active || stopped) {
        return;
      }
      active = true;
      const activeOperation = Promise.resolve()
        .then(() =>
          shutdownController.signal.aborted
            ? false
            : operation(shutdownController.signal),
        )
        .catch((error: unknown) => {
          logger.error("平台工作器执行失败", { error, worker: name });
        })
        .finally(() => {
          active = false;
          activeOperations.delete(activeOperation);
        });
      activeOperations.add(activeOperation);
    }, intervalMs);
    handle.unref?.();
    timers.push(handle);
  }

  schedule("outbox", runtime.dispatchOutbox);
  schedule("jobs", runtime.runJob);

  const state: PlatformWorkerState = {
    runtime,
    timers,
    stop(): Promise<void> {
      if (stopPromise) {
        return stopPromise;
      }
      stopped = true;
      for (const timer of timers) {
        scheduler.clearInterval(timer);
      }
      shutdownController.abort(
        new Error("平台工作器正在停止"),
      );
      stopPromise = (async () => {
        await Promise.allSettled([...activeOperations]);
        await runtime.close();
        if (workerGlobal[WORKER_STATE_SYMBOL] === state) {
          delete workerGlobal[WORKER_STATE_SYMBOL];
        }
      })();
      return stopPromise;
    },
  };
  workerGlobal[WORKER_STATE_SYMBOL] = state;
  return state;
}

export async function stopPlatformWorkers(): Promise<void> {
  await getPlatformWorkerState()?.stop();
}
