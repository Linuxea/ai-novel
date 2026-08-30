import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPlatformWorkerState,
  startPlatformWorkers,
  stopPlatformWorkers,
  type WorkerLoopRuntime,
  type WorkerTimerHandle,
} from "@/platform/jobs";
import {
  register,
  shouldStartPlatformWorkers,
} from "../../src/instrumentation";

afterEach(async () => {
  await stopPlatformWorkers();
  vi.unstubAllEnvs();
});

describe("平台 instrumentation", () => {
  it("只在非构建、非测试的 Node runtime 启动", () => {
    expect(
      shouldStartPlatformWorkers({
        NEXT_RUNTIME: "nodejs",
        NODE_ENV: "production",
        PLATFORM_WORKERS_ENABLED: "true",
      }),
    ).toBe(true);
    expect(
      shouldStartPlatformWorkers({
        NEXT_RUNTIME: "edge",
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(
      shouldStartPlatformWorkers({
        NEXT_PHASE: "phase-production-build",
        NEXT_RUNTIME: "nodejs",
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(
      shouldStartPlatformWorkers({
        NEXT_RUNTIME: "nodejs",
        NODE_ENV: "test",
      }),
    ).toBe(false);
    expect(
      shouldStartPlatformWorkers({
        NEXT_RUNTIME: "nodejs",
        NODE_ENV: "production",
        PLATFORM_WORKERS_ENABLED: "false",
      }),
    ).toBe(false);
  });

  it("全局单例避免热更新重复启动并支持 unref 与停止", async () => {
    const callbacks: Array<() => void> = [];
    const cleared: WorkerTimerHandle[] = [];
    let factoryCalls = 0;
    let closes = 0;
    let dispatches = 0;
    let jobRuns = 0;
    let unrefs = 0;
    const runtime: WorkerLoopRuntime = {
      close() {
        closes += 1;
      },
      async dispatchOutbox() {
        dispatches += 1;
        return false;
      },
      async runJob() {
        jobRuns += 1;
        return false;
      },
    };
    const scheduler = {
      clearInterval(handle: WorkerTimerHandle) {
        cleared.push(handle);
      },
      setInterval(callback: () => void) {
        callbacks.push(callback);
        return {
          unref() {
            unrefs += 1;
          },
        };
      },
    };
    const options = {
      createRuntime: () => {
        factoryCalls += 1;
        return runtime;
      },
      intervalMs: 10,
      scheduler,
    };

    const first = startPlatformWorkers(options);
    const second = startPlatformWorkers(options);
    callbacks.forEach((callback) => callback());
    await Promise.resolve();
    await Promise.resolve();

    expect(second).toBe(first);
    expect(getPlatformWorkerState()).toBe(first);
    expect(factoryCalls).toBe(1);
    expect(callbacks).toHaveLength(2);
    expect(unrefs).toBe(2);
    expect(dispatches).toBe(1);
    expect(jobRuns).toBe(1);

    await stopPlatformWorkers();
    expect(cleared).toHaveLength(2);
    expect(closes).toBe(1);
    expect(getPlatformWorkerState()).toBeUndefined();
  });

  it("stop 中止活动 operation 并等待 settle 后才关闭数据库", async () => {
    const callbacks: Array<() => void> = [];
    let closeCalls = 0;
    let observedAbort = false;
    let releaseOperation: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    const runtime: WorkerLoopRuntime = {
      close() {
        closeCalls += 1;
      },
      async dispatchOutbox(signal) {
        markStarted?.();
        await new Promise<void>((resolveOperation) => {
          releaseOperation = resolveOperation;
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
            },
            { once: true },
          );
        });
        return false;
      },
      async runJob() {
        return false;
      },
    };
    const state = startPlatformWorkers({
      createRuntime: () => runtime,
      intervalMs: 10,
      logger: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      },
      scheduler: {
        clearInterval: () => undefined,
        setInterval(callback) {
          callbacks.push(callback);
          return {};
        },
      },
    });
    callbacks[0]?.();
    await started;

    const stopping = state.stop();
    expect(observedAbort).toBe(true);
    expect(closeCalls).toBe(0);
    releaseOperation?.();
    await stopping;

    expect(closeCalls).toBe(1);
    expect(getPlatformWorkerState()).toBeUndefined();
  });

  it("测试环境调用 register 不启动工作器", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "test");

    await register();

    expect(getPlatformWorkerState()).toBeUndefined();
  });
});
