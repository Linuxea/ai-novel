import { describe, expect, it } from "vitest";
import {
  createEventEnvelope,
  DOMAIN_MODULES,
  isDomainEventName,
  parseDomainEventName,
} from "@/shared/contracts";
import { MODULE_ENTRYPOINTS } from "@/modules";

describe("领域公共契约", () => {
  it("固定六个垂直模块且名称唯一", () => {
    expect(DOMAIN_MODULES).toEqual([
      "projects",
      "canon",
      "narrative",
      "manuscript",
      "changes",
      "intelligence",
    ]);
    expect(new Set(DOMAIN_MODULES).size).toBe(DOMAIN_MODULES.length);
    expect(MODULE_ENTRYPOINTS.map((entrypoint) => entrypoint.name)).toEqual(
      DOMAIN_MODULES,
    );
  });

  it("只接受带模块、事实和主版本的领域事件名", () => {
    expect(isDomainEventName("manuscript.chapter.revised.v1")).toBe(true);
    expect(isDomainEventName("canon.character.created.v2")).toBe(true);
    expect(isDomainEventName("chapter.revised")).toBe(false);
    expect(isDomainEventName("unknown.chapter.revised.v1")).toBe(false);
    expect(isDomainEventName("manuscript.chapter.revised.v0")).toBe(false);
    expect(isDomainEventName("manuscript.chapter.revised.v-1")).toBe(false);
    expect(isDomainEventName("manuscript..revised.v1")).toBe(false);
  });

  it("解析事件名并拒绝信封 schema 版本不一致", () => {
    expect(parseDomainEventName("manuscript.chapter.revised.v2")).toMatchObject({
      aggregateType: "chapter",
      module: "manuscript",
      version: 2,
      value: "manuscript.chapter.revised.v2",
    });

    expect(() =>
      createEventEnvelope({
        eventId: "event-1",
        eventName: "manuscript.chapter.revised.v2",
        occurredAt: "2026-08-30T00:00:00.000Z",
        aggregate: {
          module: "manuscript",
          aggregateType: "chapter",
          aggregateId: "chapter-1",
          version: 2,
        },
        correlationId: "correlation-1",
        payload: { chapterId: "chapter-1" },
        metadata: { schemaVersion: 1 },
      }),
    ).toThrow("事件版本与 schema 版本不一致");
  });

  it("拒绝事件名与聚合模块或类型错配", () => {
    const base = {
      eventId: "event-mismatch",
      eventName: "canon.character.created.v1",
      occurredAt: "2026-08-30T00:00:00.000Z",
      correlationId: "correlation-mismatch",
      payload: { characterId: "character-1" },
      metadata: { schemaVersion: 1 },
    };

    expect(() =>
      createEventEnvelope({
        ...base,
        aggregate: {
          module: "narrative",
          aggregateType: "character",
          aggregateId: "character-1",
          version: 1,
        },
      }),
    ).toThrow("事件模块与聚合模块不一致");

    expect(() =>
      createEventEnvelope({
        ...base,
        aggregate: {
          module: "canon",
          aggregateType: "persona",
          aggregateId: "character-1",
          version: 1,
        },
      }),
    ).toThrow("事件聚合段与聚合类型不一致");
  });

  it("只通过构造 API 创建有效事件信封", () => {
    const envelope = createEventEnvelope({
      eventId: "event-2",
      eventName: "canon.character.created.v1",
      occurredAt: "2026-08-30T00:00:00.000Z",
      aggregate: {
        module: "canon",
        aggregateType: "character",
        aggregateId: "character-1",
        version: 1,
      },
      correlationId: "correlation-2",
      payload: { characterId: "character-1" },
      metadata: { schemaVersion: 1 },
    });

    expect(envelope.eventName).toBe("canon.character.created.v1");
    expect(envelope.metadata.schemaVersion).toBe(1);
  });
});
