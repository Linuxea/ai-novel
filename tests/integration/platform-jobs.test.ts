import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSqliteDatabase } from "@/platform/database";
import {
  JobCancelledError,
  JobPayloadCompatibilityError,
  JobPayloadSerializationError,
  RetryableJobError,
  defineJobCatalog,
  createJobRepository,
  createJobRunner,
  startPlatformWorkers,
  stopPlatformWorkers,
  type JobCancellationWatcher,
  type WorkerTimerHandle,
} from "@/platform/jobs";

const temporaryDirectories: string[] = [];

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "ai-novel-jobs-"));
  temporaryDirectories.push(directory);
  const connection = createSqliteDatabase({
    filePath: join(directory, "jobs.sqlite"),
  });
  let now = new Date("2026-08-30T00:00:00.000Z");
  let idSequence = 0;
  let leaseSequence = 0;
  const clock = () => now;
  const repository = createJobRepository(connection, {
    clock,
    idGenerator: () => `job-${++idSequence}`,
    leaseTokenGenerator: () => `job-lease-${++leaseSequence}`,
  });

  return {
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
    clock,
    connection,
    repository,
  };
}

afterEach(async () => {
  await stopPlatformWorkers();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("持久任务平台", () => {
  it("相同任务类型与幂等键只入队一次", () => {
    const fixture = createFixture();

    try {
      const first = fixture.repository.enqueue({
        idempotencyKey: "chapter-1:summary:v1",
        payload: { chapterId: "chapter-1" },
        type: "summarize-chapter",
      });
      const second = fixture.repository.enqueue({
        idempotencyKey: "chapter-1:summary:v1",
        payload: { chapterId: "ignored" },
        type: "summarize-chapter",
      });

      expect(second.id).toBe(first.id);
      expect(second.payload).toEqual({ chapterId: "chapter-1" });
      expect(
        fixture.connection.client
          .prepare("SELECT count(*) AS count FROM jobs")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      fixture.connection.close();
    }
  });

  it("原子领取阻止重复消费且过期租约可恢复", () => {
    const fixture = createFixture();

    try {
      fixture.repository.enqueue({
        idempotencyKey: "claim-1",
        payload: {},
        type: "claim-probe",
      });
      const first = fixture.repository.claimNext({
        leaseDurationMs: 1_000,
        types: ["claim-probe"],
        workerId: "worker-1",
      });
      const duplicate = fixture.repository.claimNext({
        leaseDurationMs: 1_000,
        types: ["claim-probe"],
        workerId: "worker-2",
      });

      expect(first?.record.attempt).toBe(1);
      expect(duplicate).toBeUndefined();

      fixture.advance(1_001);
      const recovered = fixture.repository.claimNext({
        leaseDurationMs: 1_000,
        types: ["claim-probe"],
        workerId: "worker-2",
      });
      expect(recovered?.record.attempt).toBe(2);
      expect(recovered?.leaseToken).not.toBe(first?.leaseToken);
      expect(
        fixture.repository.succeed(first!, { stale: true }),
      ).toBe(false);
    } finally {
      fixture.connection.close();
    }
  });

  it("多次崩溃耗尽尝试后持久失败且并发工作器不能再领取", () => {
    const fixture = createFixture();
    const secondConnection = createSqliteDatabase({
      filePath: fixture.connection.filePath,
      migrate: false,
    });
    const competingRepository = createJobRepository(
      secondConnection,
      {
        clock: fixture.clock,
        leaseTokenGenerator: () => "competing-lease",
      },
    );

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "lease-exhausted",
        maxAttempts: 2,
        payload: {},
        type: "lease-probe",
      });

      expect(
        fixture.repository.claimNext({
          leaseDurationMs: 1_000,
          types: ["lease-probe"],
          workerId: "worker-crash-1",
        })?.record.attempt,
      ).toBe(1);
      fixture.advance(1_001);
      expect(
        competingRepository.claimNext({
          leaseDurationMs: 1_000,
          types: ["lease-probe"],
          workerId: "worker-crash-2",
        })?.record.attempt,
      ).toBe(2);
      fixture.advance(1_001);

      expect(
        fixture.repository.claimNext({
          leaseDurationMs: 1_000,
          types: ["lease-probe"],
          workerId: "worker-after-limit",
        }),
      ).toBeUndefined();
      expect(
        competingRepository.claimNext({
          leaseDurationMs: 1_000,
          types: ["lease-probe"],
          workerId: "worker-competing",
        }),
      ).toBeUndefined();
      expect(fixture.repository.get(job.id)).toMatchObject({
        attempt: 2,
        error: {
          code: "lease_expired",
          name: "LeaseExpiredError",
        },
        finishedAt: fixture.clock().toISOString(),
        status: "failed",
      });
      expect(
        fixture.repository
          .listEvents({ jobId: job.id })
          .at(-1),
      ).toMatchObject({
        data: {
          attempt: 2,
          error: {
            code: "lease_expired",
            name: "LeaseExpiredError",
          },
          recoveredExpiredLease: true,
        },
        type: "failed",
      });
    } finally {
      secondConnection.close();
      fixture.connection.close();
    }
  });

  it("状态机只允许当前租约完成并阻止终态回退", () => {
    const fixture = createFixture();

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "state-machine",
        payload: {},
        type: "state-probe",
      });
      const claim = fixture.repository.claimNext({
        leaseDurationMs: 1_000,
        types: ["state-probe"],
        workerId: "worker",
      });

      expect(fixture.repository.reportProgress(claim!, 40)).toBe(true);
      expect(fixture.repository.succeed(claim!, { ok: true })).toBe(true);
      expect(fixture.repository.get(job.id)).toMatchObject({
        progress: 100,
        result: { ok: true },
        status: "succeeded",
      });
      expect(
        fixture.repository.fail(claim!, new Error("late"), {
          retryable: true,
          retryDelayMs: 10,
        }),
      ).toBe(false);
      expect(fixture.repository.reportProgress(claim!, 50)).toBe(false);
    } finally {
      fixture.connection.close();
    }
  });

  it("排队任务立即取消，运行任务先请求再由工作器确认", () => {
    const fixture = createFixture();

    try {
      const queued = fixture.repository.enqueue({
        idempotencyKey: "cancel-queued",
        payload: {},
        type: "cancel-probe",
      });
      expect(fixture.repository.requestCancel(queued.id)?.status).toBe(
        "cancelled",
      );

      const running = fixture.repository.enqueue({
        idempotencyKey: "cancel-running",
        payload: {},
        type: "cancel-probe",
      });
      const claim = fixture.repository.claimNext({
        leaseDurationMs: 1_000,
        types: ["cancel-probe"],
        workerId: "worker",
      });
      expect(claim?.record.id).toBe(running.id);
      expect(fixture.repository.requestCancel(running.id)).toMatchObject({
        cancelRequestedAt: fixture.clock().toISOString(),
        status: "running",
      });
      expect(fixture.repository.isCancellationRequested(running.id)).toBe(
        true,
      );
      expect(fixture.repository.acknowledgeCancellation(claim!)).toBe(true);
      expect(fixture.repository.get(running.id)?.status).toBe("cancelled");
    } finally {
      fixture.connection.close();
    }
  });

  it("进度和状态事件可按持久游标重放", () => {
    const fixture = createFixture();

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "events",
        payload: {},
        type: "event-probe",
      });
      const initialEvents = fixture.repository.listEvents({
        afterCursor: 0,
        jobId: job.id,
      });
      const claim = fixture.repository.claimNext({
        leaseDurationMs: 1_000,
        types: ["event-probe"],
        workerId: "worker",
      });
      fixture.repository.reportProgress(claim!, 25, {
        completed: 1,
        total: 4,
      });

      const replay = fixture.repository.listEvents({
        afterCursor: initialEvents.at(-1)!.cursor,
        jobId: job.id,
      });

      expect(initialEvents.map((event) => event.type)).toEqual(["queued"]);
      expect(replay.map((event) => event.type)).toEqual([
        "running",
        "progress",
      ]);
      expect(replay.at(-1)).toMatchObject({
        data: { completed: 1, progress: 25, total: 4 },
        jobId: job.id,
      });
    } finally {
      fixture.connection.close();
    }
  });

  it("runner 执行处理器、上报进度并成功持久化结果", async () => {
    const fixture = createFixture();
    const runner = createJobRunner<{
      "write-probe": {
        payload: { chapterId: string };
        result: { text: string };
      };
    }>({
      leaseDurationMs: 1_000,
      repository: fixture.repository,
      workerId: "runner-success",
    });
    runner.register("write-probe", async (context) => {
      expect(context.signal.aborted).toBe(false);
      context.reportProgress(50, { phase: "draft" });
      return { text: `chapter:${context.payload.chapterId}` };
    });

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "runner-success",
        payload: { chapterId: "chapter-1" },
        type: "write-probe",
      });

      expect(await runner.runOnce()).toBe(true);
      expect(fixture.repository.get(job.id)).toMatchObject({
        result: { text: "chapter:chapter-1" },
        status: "succeeded",
      });
    } finally {
      fixture.connection.close();
    }
  });

  it("runner 按错误类型和注入退避重试", async () => {
    const fixture = createFixture();
    let executions = 0;
    const runner = createJobRunner<{
      "retry-probe": {
        payload: Record<string, never>;
        result: { ok: true };
      };
    }>({
      backoff: (attempt) => attempt * 200,
      leaseDurationMs: 1_000,
      repository: fixture.repository,
      workerId: "runner-retry",
    });
    runner.register("retry-probe", () => {
      executions += 1;
      if (executions === 1) {
        throw new RetryableJobError("provider_busy");
      }
      return { ok: true };
    });

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "runner-retry",
        maxAttempts: 3,
        payload: {},
        type: "retry-probe",
      });

      expect(await runner.runOnce()).toBe(true);
      expect(fixture.repository.get(job.id)).toMatchObject({
        attempt: 1,
        runAt: "2026-08-30T00:00:00.200Z",
        status: "queued",
      });
      expect(await runner.runOnce()).toBe(false);

      fixture.advance(200);
      expect(await runner.runOnce()).toBe(true);
      expect(fixture.repository.get(job.id)?.status).toBe("succeeded");
      expect(executions).toBe(2);
    } finally {
      fixture.connection.close();
    }
  });

  it("runner 通过取消检查中止处理并落入 cancelled", async () => {
    const fixture = createFixture();
    const runner = createJobRunner<{
      "cancel-runner": {
        payload: Record<string, never>;
        result: never;
      };
    }>({
      leaseDurationMs: 1_000,
      repository: fixture.repository,
      workerId: "runner-cancel",
    });
    runner.register("cancel-runner", (context) => {
      fixture.repository.requestCancel(context.jobId);
      expect(context.isCancellationRequested()).toBe(true);
      expect(context.signal.aborted).toBe(true);
      context.throwIfCancelled();
      throw new JobCancelledError();
    });

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "runner-cancel",
        payload: {},
        type: "cancel-runner",
      });

      expect(await runner.runOnce()).toBe(true);
      expect(fixture.repository.get(job.id)?.status).toBe("cancelled");
    } finally {
      fixture.connection.close();
    }
  });

  it("runner 监视外部取消并主动触发只监听 signal 的处理器", async () => {
    const fixture = createFixture();
    let notifyCancellation: (() => void) | undefined;
    let finishWithoutWatcher: (() => void) | undefined;
    let cleanedWatchers = 0;
    let observedAbort = false;
    const cancellationWatcher: JobCancellationWatcher = {
      watch(jobId, onCancellation) {
        expect(jobId).toBe("job-1");
        notifyCancellation = onCancellation;
        return () => {
          cleanedWatchers += 1;
        };
      },
    };
    const runner = createJobRunner<{
      "signal-only": {
        payload: Record<string, never>;
        result: { ignored: true };
      };
    }>({
      cancellationWatcher,
      leaseDurationMs: 1_000,
      repository: fixture.repository,
      workerId: "runner-signal",
    });
    runner.register(
      "signal-only",
      (context) =>
        new Promise((resolve, reject) => {
          finishWithoutWatcher = () =>
            resolve({ ignored: true });
          context.signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              reject(context.signal.reason);
            },
            { once: true },
          );
        }),
    );

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "signal-only",
        payload: {},
        type: "signal-only",
      });
      const run = runner.runOnce();
      if (!notifyCancellation) {
        finishWithoutWatcher?.();
        await run;
      }
      expect(notifyCancellation).toBeTypeOf("function");

      fixture.repository.requestCancel(job.id);
      notifyCancellation?.();
      await run;

      expect(observedAbort).toBe(true);
      expect(fixture.repository.get(job.id)?.status).toBe(
        "cancelled",
      );
      expect(cleanedWatchers).toBe(1);
    } finally {
      fixture.connection.close();
    }
  });

  it("runner 长处理期间续租并暴露 attempt、fencing token 与幂等键", async () => {
    const fixture = createFixture();
    let beat: (() => void) | undefined;
    let finish: (() => void) | undefined;
    let cleaned = 0;
    const heartbeat = {
      start(options: {
        readonly onLeaseLost: () => void;
        readonly renewLease: () => boolean;
      }) {
        beat = () => {
          if (!options.renewLease()) {
            options.onLeaseLost();
          }
        };
        return () => {
          cleaned += 1;
        };
      },
    };
    const runner = createJobRunner({
      heartbeat,
      leaseDurationMs: 1_000,
      repository: fixture.repository,
      workerId: "runner-heartbeat",
    });
    runner.register(
      "heartbeat-probe",
      (context) =>
        new Promise<Record<string, never>>((resolveHandler) => {
          expect(context.attempt).toBe(1);
          expect(context.fencingToken).toBe("job-lease-1");
          expect(context.idempotencyKey).toBe("heartbeat-job");
          finish = () => resolveHandler({});
        }),
    );

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "heartbeat-job",
        payload: {},
        type: "heartbeat-probe",
      });
      const running = runner.runOnce();
      if (!beat) {
        finish?.();
        await running;
      }
      expect(beat).toBeTypeOf("function");

      fixture.advance(800);
      beat?.();
      fixture.advance(500);
      expect(
        fixture.repository.claimNext({
          leaseDurationMs: 1_000,
          types: ["heartbeat-probe"],
          workerId: "competing-worker",
        }),
      ).toBeUndefined();
      finish?.();
      await running;

      expect(fixture.repository.get(job.id)?.status).toBe(
        "succeeded",
      );
      expect(cleaned).toBe(1);
    } finally {
      fixture.connection.close();
    }
  });

  it("runner heartbeat 丢失租约时立即 abort 且不提交旧 claim", async () => {
    const fixture = createFixture();
    let beat: (() => void) | undefined;
    let finishWithoutHeartbeat: (() => void) | undefined;
    let observedAbort = false;
    let cleaned = 0;
    const runner = createJobRunner({
      heartbeat: {
        start(options: {
          readonly onLeaseLost: () => void;
          readonly renewLease: () => boolean;
        }) {
          beat = () => {
            if (!options.renewLease()) {
              options.onLeaseLost();
            }
          };
          return () => {
            cleaned += 1;
          };
        },
      },
      leaseDurationMs: 1_000,
      repository: fixture.repository,
      workerId: "runner-lost-lease",
    });
    runner.register(
      "lost-lease",
      (context) =>
        new Promise<Record<string, never>>((resolve, reject) => {
          finishWithoutHeartbeat = () => resolve({});
          context.signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              reject(context.signal.reason);
            },
            { once: true },
          );
        }),
    );

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "lost-lease",
        payload: {},
        type: "lost-lease",
      });
      const running = runner.runOnce();
      if (!beat) {
        finishWithoutHeartbeat?.();
        await running;
      }
      expect(beat).toBeTypeOf("function");

      fixture.connection.client
        .prepare(
          "UPDATE jobs SET lease_token = 'stolen' WHERE id = ?",
        )
        .run(job.id);
      beat?.();
      await running;

      expect(observedAbort).toBe(true);
      expect(fixture.repository.get(job.id)).toMatchObject({
        leaseToken: "stolen",
        status: "running",
      });
      expect(cleaned).toBe(1);
    } finally {
      fixture.connection.close();
    }
  });

  it("取消在最后检查后到达时原子终态提交优先 cancelled", async () => {
    const fixture = createFixture();
    const repository = {
      ...fixture.repository,
      succeed: (
        claim: Parameters<typeof fixture.repository.succeed>[0],
        result: unknown,
      ) => {
        fixture.repository.requestCancel(claim.record.id);
        return fixture.repository.succeed(claim, result);
      },
    };
    const runner = createJobRunner({
      leaseDurationMs: 1_000,
      repository,
      workerId: "runner-cancel-race",
    });
    runner.register("cancel-race", () => ({ done: true }));

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "cancel-race",
        payload: {},
        type: "cancel-race",
      });

      expect(await runner.runOnce()).toBe(true);
      expect(fixture.repository.get(job.id)?.status).toBe(
        "cancelled",
      );
      expect(
        fixture.repository
          .listEvents({ jobId: job.id })
          .at(-1)?.type,
      ).toBe("cancelled");
    } finally {
      fixture.connection.close();
    }
  });

  it("重试 claim 重置本 attempt 进度且事件记录 attempt", () => {
    const fixture = createFixture();

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "attempt-progress",
        maxAttempts: 2,
        payload: {},
        type: "attempt-progress",
      });
      const first = fixture.repository.claimNext({
        leaseDurationMs: 1_000,
        types: ["attempt-progress"],
        workerId: "worker-1",
      });
      expect(fixture.repository.reportProgress(first!, 80)).toBe(true);
      expect(
        fixture.repository.fail(first!, new Error("retry"), {
          retryable: true,
          retryDelayMs: 0,
        }),
      ).toBe(true);

      const second = fixture.repository.claimNext({
        leaseDurationMs: 1_000,
        types: ["attempt-progress"],
        workerId: "worker-2",
      });
      expect(second?.record).toMatchObject({
        attempt: 2,
        progress: 0,
      });
      expect(fixture.repository.reportProgress(second!, 10)).toBe(
        true,
      );
      expect(
        fixture.repository.succeed(second!, { done: true }),
      ).toBe(true);
      expect(
        fixture.repository
          .listEvents({ jobId: job.id })
          .filter((event) => event.type === "progress")
          .map((event) => event.data),
      ).toEqual([
        { attempt: 1, progress: 80 },
        { attempt: 2, progress: 10 },
      ]);
    } finally {
      fixture.connection.close();
    }
  });

  it("持久任务错误在写库前统一脱敏并限制长度", () => {
    const fixture = createFixture();
    const secretMessage = [
      "Cookie: session=cookie-secret",
      '{"apiKey":"json-secret"}',
      "token: colon-secret",
      "accessToken=access-secret",
      '{"client_secret":"client-secret"}',
      "https://user:user-secret@example.com/?token=query-secret",
      "Authorization: Bearer bearer-secret",
      "password=value-secret",
      "x".repeat(10_000),
    ].join(" ");

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "safe-error",
        payload: {},
        type: "safe-error",
      });
      const claim = fixture.repository.claimNext({
        leaseDurationMs: 1_000,
        types: ["safe-error"],
        workerId: "worker",
      });
      fixture.repository.fail(
        claim!,
        Object.assign(new Error(secretMessage), {
          rawResponse: { apiKey: "object-secret" },
        }),
        { retryable: false, retryDelayMs: 0 },
      );

      const serialized = JSON.stringify(
        fixture.repository.get(job.id)?.error,
      );
      for (const secret of [
        "cookie-secret",
        "json-secret",
        "colon-secret",
        "access-secret",
        "client-secret",
        "user-secret",
        "query-secret",
        "bearer-secret",
        "value-secret",
        "object-secret",
      ]) {
        expect(serialized).not.toContain(secret);
      }
      expect(serialized.length).toBeLessThanOrEqual(4_096);
    } finally {
      fixture.connection.close();
    }
  });

  it("typed JobCatalog 校验 enqueue 并拒绝持久化非法 payload", async () => {
    const fixture = createFixture();
    const catalog = defineJobCatalog({
      "catalog-probe": {
        payloadSchema: z.object({ chapterId: z.string().min(1) }),
        resultSchema: z.object({ ok: z.literal(true) }),
      },
    });
    const repository = createJobRepository(fixture.connection, {
      catalog,
      clock: fixture.clock,
      idGenerator: () => "catalog-job",
      leaseTokenGenerator: () => "catalog-lease",
    });
    const runner = createJobRunner({
      catalog,
      leaseDurationMs: 1_000,
      repository,
      workerId: "catalog-runner",
    });
    let handlerCalls = 0;
    runner.register("catalog-probe", (context) => {
      handlerCalls += 1;
      expect(context.payload.chapterId).toBe("chapter-1");
      return { ok: true as const };
    });

    try {
      const job = repository.enqueue({
        idempotencyKey: "catalog-probe",
        payload: { chapterId: "chapter-1" },
        type: "catalog-probe",
      });
      fixture.connection.client
        .prepare("UPDATE jobs SET payload_json = ? WHERE id = ?")
        .run('{"chapterId":42}', job.id);

      expect(await runner.runOnce()).toBe(true);
      expect(handlerCalls).toBe(0);
      expect(repository.get(job.id)).toMatchObject({
        error: { code: "invalid_payload" },
        status: "failed",
      });
      expect(
        repository
          .listEvents({ jobId: job.id })
          .at(-1)?.type,
      ).toBe("failed");
      expect(() =>
        repository.enqueue({
          idempotencyKey: "invalid-enqueue",
          payload: {
            chapterId: 42,
          } as unknown as { chapterId: string },
          type: "catalog-probe",
        }),
      ).toThrow("payload");
    } finally {
      fixture.connection.close();
    }
  });

  it("幂等冲突按当前 catalog 重验旧 payload 并返回 typed error", () => {
    const fixture = createFixture();
    const originalCatalog = defineJobCatalog({
      "schema-upgrade": {
        payloadSchema: z.object({ chapterId: z.string() }),
        resultSchema: z.object({ ok: z.boolean() }),
      },
    });
    const upgradedCatalog = defineJobCatalog({
      "schema-upgrade": {
        payloadSchema: z.object({
          chapterId: z.string(),
          revision: z.number().int(),
        }),
        resultSchema: z.object({ ok: z.boolean() }),
      },
    });
    const originalRepository = createJobRepository(
      fixture.connection,
      { catalog: originalCatalog, clock: fixture.clock },
    );
    const upgradedRepository = createJobRepository(
      fixture.connection,
      { catalog: upgradedCatalog, clock: fixture.clock },
    );

    try {
      originalRepository.enqueue({
        idempotencyKey: "same-key",
        payload: { chapterId: "chapter-1" },
        type: "schema-upgrade",
      });

      expect(() =>
        upgradedRepository.enqueue({
          idempotencyKey: "same-key",
          payload: { chapterId: "chapter-1", revision: 2 },
          type: "schema-upgrade",
        }),
      ).toThrow(JobPayloadCompatibilityError);
    } finally {
      fixture.connection.close();
    }
  });

  it("catalog transform 保留 null 且明确拒绝 undefined JSON payload", () => {
    const fixture = createFixture();
    const nullCatalog = defineJobCatalog({
      "null-transform": {
        payloadSchema: z.string().transform(() => null),
        resultSchema: z.object({ ok: z.boolean() }),
      },
    });
    const undefinedCatalog = defineJobCatalog({
      "undefined-transform": {
        payloadSchema: z.string().transform(() => undefined),
        resultSchema: z.object({ ok: z.boolean() }),
      },
    });

    try {
      const nullRepository = createJobRepository(
        fixture.connection,
        { catalog: nullCatalog, clock: fixture.clock },
      );
      expect(
        nullRepository.enqueue({
          idempotencyKey: "null-transform",
          payload: "source",
          type: "null-transform",
        }).payload,
      ).toBeNull();

      const undefinedRepository = createJobRepository(
        fixture.connection,
        { catalog: undefinedCatalog, clock: fixture.clock },
      );
      expect(() =>
        undefinedRepository.enqueue({
          idempotencyKey: "undefined-transform",
          payload: "source",
          type: "undefined-transform",
        }),
      ).toThrow(JobPayloadSerializationError);
    } finally {
      fixture.connection.close();
    }
  });

  it("runtime stop 中止实际长 job handler 并等待 runner 清理后关库", async () => {
    const fixture = createFixture();
    const callbacks: Array<() => void> = [];
    let handlerStarted: (() => void) | undefined;
    let observedAbort = false;
    const started = new Promise<void>((resolveStarted) => {
      handlerStarted = resolveStarted;
    });
    const runner = createJobRunner({
      leaseDurationMs: 1_000,
      repository: fixture.repository,
      workerId: "runtime-stop",
    });
    runner.register(
      "long-job",
      (context) =>
        new Promise<Record<string, never>>((_resolve, reject) => {
          handlerStarted?.();
          context.signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              reject(context.signal.reason);
            },
            { once: true },
          );
        }),
    );
    fixture.repository.enqueue({
      idempotencyKey: "long-job",
      payload: {},
      type: "long-job",
    });
    const state = startPlatformWorkers({
      createRuntime: () => ({
        close: () => fixture.connection.close(),
        dispatchOutbox: async () => false,
        runJob: (signal) => runner.runOnce(signal),
      }),
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
          return {} as WorkerTimerHandle;
        },
      },
    });

    callbacks.forEach((callback) => callback());
    await started;
    const stopping = state.stop();
    expect(fixture.connection.isOpen()).toBe(true);
    await stopping;

    expect(observedAbort).toBe(true);
    expect(fixture.connection.isOpen()).toBe(false);
  });

  it("没有注册处理器时安全空转且不领取任务", async () => {
    const fixture = createFixture();
    const runner = createJobRunner({
      leaseDurationMs: 1_000,
      repository: fixture.repository,
      workerId: "runner-empty",
    });

    try {
      const job = fixture.repository.enqueue({
        idempotencyKey: "unregistered",
        payload: {},
        type: "unknown-job",
      });

      expect(await runner.runOnce()).toBe(false);
      expect(fixture.repository.get(job.id)?.status).toBe("queued");
    } finally {
      fixture.connection.close();
    }
  });
});
