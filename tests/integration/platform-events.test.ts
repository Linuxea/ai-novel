import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEventBus,
  createOutboxDispatcher,
  createOutboxRepository,
} from "@/platform/events";
import { createSqliteDatabase } from "@/platform/database";
import { createEventEnvelope } from "@/shared/contracts";

const temporaryDirectories: string[] = [];

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "ai-novel-events-"));
  temporaryDirectories.push(directory);
  const connection = createSqliteDatabase({
    filePath: join(directory, "events.sqlite"),
  });
  let now = new Date("2026-08-30T00:00:00.000Z");

  return {
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
    clock: () => now,
    connection,
  };
}

function createCharacterEvent(eventId: string) {
  return createEventEnvelope({
    eventId,
    eventName: "canon.character.created.v1",
    occurredAt: "2026-08-30T00:00:00.000Z",
    aggregate: {
      module: "canon",
      aggregateType: "character",
      aggregateId: "character-1",
      version: 1,
    },
    correlationId: "request-1",
    payload: { characterId: "character-1" },
    metadata: { schemaVersion: 1 },
  });
}

function createChapterEvent(eventId: string) {
  return createEventEnvelope({
    eventId,
    eventName: "manuscript.chapter.revised.v1",
    occurredAt: "2026-08-30T00:00:00.000Z",
    aggregate: {
      module: "manuscript",
      aggregateType: "chapter",
      aggregateId: "chapter-1",
      version: 1,
    },
    correlationId: "request-1",
    payload: { chapterId: "chapter-1" },
    metadata: { schemaVersion: 1 },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("事务 outbox 与事件总线", () => {
  it("EventBus 取消订阅后不再调用处理器", async () => {
    const bus = createEventBus<{
      "canon.character.created.v1": { characterId: string };
    }>();
    const received: string[] = [];
    const unsubscribe = bus.subscribe(
      "canon.character.created.v1",
      (envelope) => {
        received.push(envelope.payload.characterId);
      },
    );
    const envelope = createCharacterEvent("event-bus-1");

    await bus.publish("canon.character.created.v1", envelope);
    unsubscribe();
    await bus.publish("canon.character.created.v1", envelope);

    expect(received).toEqual(["character-1"]);
  });

  it("事件与业务状态同事务提交或回滚", () => {
    const fixture = createFixture();
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-atomic",
    });
    fixture.connection.client.exec(
      "CREATE TABLE business_probe (id TEXT PRIMARY KEY)",
    );

    try {
      expect(() =>
        fixture.connection.unitOfWork.run((transaction) => {
          transaction.client
            .prepare("INSERT INTO business_probe (id) VALUES (?)")
            .run("rolled-back");
          repository.enqueue(
            transaction,
            createCharacterEvent("event-rolled-back"),
          );
          throw new Error("rollback");
        }),
      ).toThrow("rollback");
      expect(repository.getByEventId("event-rolled-back")).toBeUndefined();

      fixture.connection.unitOfWork.run((transaction) => {
        transaction.client
          .prepare("INSERT INTO business_probe (id) VALUES (?)")
          .run("committed");
        repository.enqueue(
          transaction,
          createCharacterEvent("event-committed"),
        );
      });

      expect(repository.getByEventId("event-committed")?.status).toBe(
        "pending",
      );
      expect(
        fixture.connection.client
          .prepare("SELECT id FROM business_probe ORDER BY id")
          .all(),
      ).toEqual([{ id: "committed" }]);
    } finally {
      fixture.connection.close();
    }
  });

  it("并发领取同一事件时只有一个工作器成功", () => {
    const fixture = createFixture();
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-claim",
      leaseTokenGenerator: () => "lease-token",
    });

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createCharacterEvent("event-claim"),
        );
      });

      const first = repository.claimNext({
        leaseDurationMs: 1_000,
        workerId: "worker-1",
      });
      const second = repository.claimNext({
        leaseDurationMs: 1_000,
        workerId: "worker-2",
      });

      expect(first?.record.envelope.eventId).toBe("event-claim");
      expect(second).toBeUndefined();
      expect(repository.getByEventId("event-claim")?.attempts).toBe(1);
    } finally {
      fixture.connection.close();
    }
  });

  it("租约过期后事件可被另一工作器恢复领取", () => {
    const fixture = createFixture();
    let leaseSequence = 0;
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-recovery",
      leaseTokenGenerator: () => `lease-${++leaseSequence}`,
    });

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createCharacterEvent("event-recovery"),
        );
      });
      const staleClaim = repository.claimNext({
        leaseDurationMs: 1_000,
        workerId: "worker-stale",
      });
      fixture.advance(1_001);
      const recoveredClaim = repository.claimNext({
        leaseDurationMs: 1_000,
        workerId: "worker-recovered",
      });

      expect(staleClaim?.leaseToken).toBe("lease-1");
      expect(recoveredClaim?.leaseToken).toBe("lease-2");
      expect(recoveredClaim?.record.attempts).toBe(2);
      expect(
        repository.markPublished(staleClaim!, fixture.clock()),
      ).toBe(false);
    } finally {
      fixture.connection.close();
    }
  });

  it("多次崩溃耗尽尝试后原子进入 dead-letter 且不再领取", () => {
    const fixture = createFixture();
    const secondConnection = createSqliteDatabase({
      filePath: fixture.connection.filePath,
      migrate: false,
    });
    let leaseSequence = 0;
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-exhausted",
      leaseTokenGenerator: () => `primary-${++leaseSequence}`,
    });
    const competingRepository = createOutboxRepository(
      secondConnection,
      {
        clock: fixture.clock,
        leaseTokenGenerator: () => "competing",
      },
    );

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createCharacterEvent("event-exhausted"),
          { maxAttempts: 2 },
        );
      });

      expect(
        repository.claimNext({
          leaseDurationMs: 1_000,
          workerId: "worker-crash-1",
        })?.record.attempts,
      ).toBe(1);
      fixture.advance(1_001);
      expect(
        competingRepository.claimNext({
          leaseDurationMs: 1_000,
          workerId: "worker-crash-2",
        })?.record.attempts,
      ).toBe(2);
      fixture.advance(1_001);

      expect(
        repository.claimNext({
          leaseDurationMs: 1_000,
          workerId: "worker-after-limit",
        }),
      ).toBeUndefined();
      expect(
        competingRepository.claimNext({
          leaseDurationMs: 1_000,
          workerId: "worker-competing",
        }),
      ).toBeUndefined();
      expect(repository.getByEventId("event-exhausted")).toMatchObject({
        attempts: 2,
        failedAt: fixture.clock().toISOString(),
        failureCode: "lease_expired",
        status: "failed",
      });
    } finally {
      secondConnection.close();
      fixture.connection.close();
    }
  });

  it("处理成功后才将事件标记为 published", async () => {
    const fixture = createFixture();
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-success",
      leaseTokenGenerator: () => "lease-success",
    });
    const bus = createEventBus<{
      "canon.character.created.v1": { characterId: string };
    }>();
    let statusDuringHandler: string | undefined;
    bus.subscribe("canon.character.created.v1", () => {
      statusDuringHandler =
        repository.getByEventId("event-success")?.status;
    });
    const dispatcher = createOutboxDispatcher({
      bus,
      leaseDurationMs: 1_000,
      repository,
      workerId: "worker-success",
    });

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createCharacterEvent("event-success"),
        );
      });

      expect(await dispatcher.dispatchOnce()).toBe(true);
      expect(statusDuringHandler).toBe("processing");
      expect(repository.getByEventId("event-success")).toMatchObject({
        attempts: 1,
        publishedAt: fixture.clock().toISOString(),
        status: "published",
      });
    } finally {
      fixture.connection.close();
    }
  });

  it("没有注册事件处理器时安全空转且不领取 outbox", async () => {
    const fixture = createFixture();
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-idle",
    });
    const bus = createEventBus();
    const dispatcher = createOutboxDispatcher({
      bus,
      leaseDurationMs: 1_000,
      repository,
      workerId: "worker-idle",
    });

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createCharacterEvent("event-idle"),
        );
      });

      expect(await dispatcher.dispatchOnce()).toBe(false);
      expect(repository.getByEventId("event-idle")?.status).toBe(
        "pending",
      );
    } finally {
      fixture.connection.close();
    }
  });

  it("只领取已有处理器的事件，不把未处理事件标记为成功", async () => {
    const fixture = createFixture();
    let idSequence = 0;
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => `outbox-filter-${++idSequence}`,
    });
    const bus = createEventBus<{
      "canon.character.created.v1": { characterId: string };
    }>();
    bus.subscribe("canon.character.created.v1", () => undefined);
    const dispatcher = createOutboxDispatcher({
      bus,
      leaseDurationMs: 1_000,
      repository,
      workerId: "worker-filter",
    });

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createChapterEvent("event-unhandled"),
        );
        repository.enqueue(
          transaction,
          createCharacterEvent("event-handled"),
        );
      });

      expect(await dispatcher.dispatchOnce()).toBe(true);
      expect(repository.getByEventId("event-unhandled")?.status).toBe(
        "pending",
      );
      expect(repository.getByEventId("event-handled")?.status).toBe(
        "published",
      );
    } finally {
      fixture.connection.close();
    }
  });

  it("处理失败按注入退避重试且达到上限后进入 dead-letter", async () => {
    const fixture = createFixture();
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-retry",
      leaseTokenGenerator: () => `lease-${fixture.clock().getTime()}`,
    });
    const bus = createEventBus<{
      "canon.character.created.v1": { characterId: string };
    }>();
    bus.subscribe("canon.character.created.v1", () => {
      throw new Error("consumer failed");
    });
    const dispatcher = createOutboxDispatcher({
      backoff: (attempt) => attempt * 100,
      bus,
      leaseDurationMs: 1_000,
      repository,
      workerId: "worker-retry",
    });

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createCharacterEvent("event-retry"),
          { maxAttempts: 2 },
        );
      });

      expect(await dispatcher.dispatchOnce()).toBe(true);
      expect(repository.getByEventId("event-retry")).toMatchObject({
        attempts: 1,
        availableAt: "2026-08-30T00:00:00.100Z",
        status: "pending",
      });
      expect(await dispatcher.dispatchOnce()).toBe(false);

      fixture.advance(100);
      expect(await dispatcher.dispatchOnce()).toBe(true);
      expect(repository.getByEventId("event-retry")).toMatchObject({
        attempts: 2,
        failedAt: "2026-08-30T00:00:00.100Z",
        failureCode: "handler_error",
        status: "failed",
      });
    } finally {
      fixture.connection.close();
    }
  });

  it("dispatcher 长处理期间 heartbeat 续租并暴露 fencing context", async () => {
    const fixture = createFixture();
    let beat: (() => void) | undefined;
    let finish: (() => void) | undefined;
    let cleaned = 0;
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-heartbeat",
      leaseTokenGenerator: () => "outbox-lease-heartbeat",
    });
    const bus = createEventBus<{
      "canon.character.created.v1": { characterId: string };
    }>();
    bus.subscribe(
      "canon.character.created.v1",
      (_envelope, context) =>
        new Promise<void>((resolveHandler) => {
          expect(context.attempt).toBe(1);
          expect(context.fencingToken).toBe(
            "outbox-lease-heartbeat",
          );
          finish = resolveHandler;
        }),
    );
    const dispatcher = createOutboxDispatcher({
      backoff: () => 1,
      bus,
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
      repository,
      workerId: "dispatcher-heartbeat",
    });

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createCharacterEvent("event-heartbeat"),
        );
      });
      const running = dispatcher.dispatchOnce();
      if (!beat) {
        finish?.();
        await running;
      }
      expect(beat).toBeTypeOf("function");

      fixture.advance(800);
      beat?.();
      fixture.advance(500);
      expect(
        repository.claimNext({
          leaseDurationMs: 1_000,
          workerId: "competing-dispatcher",
        }),
      ).toBeUndefined();
      finish?.();
      await running;

      expect(
        repository.getByEventId("event-heartbeat")?.status,
      ).toBe("published");
      expect(cleaned).toBe(1);
    } finally {
      fixture.connection.close();
    }
  });

  it("dispatcher heartbeat 丢失租约时 abort handler 且不发布旧 claim", async () => {
    const fixture = createFixture();
    let beat: (() => void) | undefined;
    let finishWithoutHeartbeat: (() => void) | undefined;
    let observedAbort = false;
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-lost",
      leaseTokenGenerator: () => "outbox-lease-lost",
    });
    const bus = createEventBus<{
      "canon.character.created.v1": { characterId: string };
    }>();
    bus.subscribe(
      "canon.character.created.v1",
      (_envelope, context) =>
        new Promise<void>((resolve, reject) => {
          finishWithoutHeartbeat = resolve;
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
    const dispatcher = createOutboxDispatcher({
      bus,
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
          return () => undefined;
        },
      },
      leaseDurationMs: 1_000,
      repository,
      workerId: "dispatcher-lost",
    });

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createCharacterEvent("event-lost"),
        );
      });
      const running = dispatcher.dispatchOnce();
      if (!beat) {
        finishWithoutHeartbeat?.();
        await running;
      }
      expect(beat).toBeTypeOf("function");

      fixture.connection.client
        .prepare(
          "UPDATE domain_events SET lease_token = 'stolen' WHERE event_id = ?",
        )
        .run("event-lost");
      beat?.();
      await running;

      expect(observedAbort).toBe(true);
      expect(repository.getByEventId("event-lost")).toMatchObject({
        leaseToken: "stolen",
        status: "processing",
      });
    } finally {
      fixture.connection.close();
    }
  });

  it("outbox 持久错误在写库前统一脱敏并限制长度", () => {
    const fixture = createFixture();
    const repository = createOutboxRepository(fixture.connection, {
      clock: fixture.clock,
      idGenerator: () => "outbox-safe-error",
      leaseTokenGenerator: () => "outbox-safe-lease",
    });
    const secretMessage = [
      "Cookie: session=cookie-secret",
      '{"apiKey":"json-secret"}',
      "token: colon-secret",
      "refreshToken=refresh-secret",
      '{"session_token":"session-secret"}',
      "https://user:user-secret@example.com/?token=query-secret",
      "Authorization: Bearer bearer-secret",
      "password=value-secret",
      "x".repeat(10_000),
    ].join(" ");

    try {
      fixture.connection.unitOfWork.run((transaction) => {
        repository.enqueue(
          transaction,
          createCharacterEvent("event-safe-error"),
        );
      });
      const claim = repository.claimNext({
        leaseDurationMs: 1_000,
        workerId: "worker",
      });
      repository.failClaim(claim!, {
        backoffMs: 1,
        error: new Error(secretMessage),
        failureCode: "provider_error",
      });

      const persisted =
        repository.getByEventId("event-safe-error")?.lastError ?? "";
      for (const secret of [
        "cookie-secret",
        "json-secret",
        "colon-secret",
        "refresh-secret",
        "session-secret",
        "user-secret",
        "query-secret",
        "bearer-secret",
        "value-secret",
      ]) {
        expect(persisted).not.toContain(secret);
      }
      expect(persisted.length).toBeLessThanOrEqual(2_048);
    } finally {
      fixture.connection.close();
    }
  });
});
