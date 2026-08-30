import { DOMAIN_MODULES, type DomainModule } from "./modules";
import type { VersionedAggregateRef } from "./versioning";

declare const domainEventNameBrand: unique symbol;
declare const eventEnvelopeBrand: unique symbol;

const DOMAIN_EVENT_NAME_PATTERN = new RegExp(
  `^(${DOMAIN_MODULES.join("|")})\\.([a-z][a-z0-9_]*)(?:\\.[a-z][a-z0-9_]*)+\\.v([1-9][0-9]*)$`,
);

export type DomainEventName = string & {
  readonly [domainEventNameBrand]: true;
};

export interface ParsedDomainEventName {
  readonly aggregateType: string;
  readonly module: DomainModule;
  readonly value: DomainEventName;
  readonly version: number;
}

export function parseDomainEventName(value: string): ParsedDomainEventName {
  const match = DOMAIN_EVENT_NAME_PATTERN.exec(value);
  const version = Number(match?.[3]);

  if (!match || !Number.isSafeInteger(version) || version < 1) {
    throw new Error(`无效领域事件名: ${JSON.stringify(value)}`);
  }

  return {
    aggregateType: match[2],
    module: match[1] as DomainModule,
    value: value as DomainEventName,
    version,
  };
}

export function isDomainEventName(value: string): value is DomainEventName {
  try {
    parseDomainEventName(value);
    return true;
  } catch {
    return false;
  }
}

export interface EventMetadata {
  readonly schemaVersion: number;
  readonly actorId?: string;
}

interface EventEnvelopeShape<TPayload> {
  readonly eventId: string;
  readonly eventName: DomainEventName;
  readonly occurredAt: string;
  readonly aggregate: VersionedAggregateRef;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly payload: TPayload;
  readonly metadata: EventMetadata;
}

export type EventEnvelope<TPayload = unknown> =
  EventEnvelopeShape<TPayload> & {
    readonly [eventEnvelopeBrand]: true;
  };

export type EventEnvelopeInput<TPayload = unknown> = Omit<
  EventEnvelopeShape<TPayload>,
  "eventName"
> & {
  readonly eventName: string;
};

export function createEventEnvelope<TPayload>(
  input: EventEnvelopeInput<TPayload>,
): EventEnvelope<TPayload> {
  const parsedName = parseDomainEventName(input.eventName);
  if (parsedName.module !== input.aggregate.module) {
    throw new Error("事件模块与聚合模块不一致");
  }
  if (parsedName.aggregateType !== input.aggregate.aggregateType) {
    throw new Error("事件聚合段与聚合类型不一致");
  }
  if (
    !Number.isSafeInteger(input.metadata.schemaVersion) ||
    input.metadata.schemaVersion < 1 ||
    parsedName.version !== input.metadata.schemaVersion
  ) {
    throw new Error("事件版本与 schema 版本不一致");
  }

  return {
    ...input,
    eventName: parsedName.value,
    metadata: { ...input.metadata },
  } as EventEnvelope<TPayload>;
}

interface OutboxMessageBase<TPayload> {
  readonly outboxId: string;
  readonly envelope: EventEnvelope<TPayload>;
  readonly attempts: number;
  readonly createdAt: string;
}

export type OutboxMessage<TPayload = unknown> =
  | (OutboxMessageBase<TPayload> & {
      readonly status: "pending";
      readonly availableAt: string;
      readonly publishedAt?: never;
      readonly failedAt?: never;
      readonly failureCode?: never;
    })
  | (OutboxMessageBase<TPayload> & {
      readonly status: "published";
      readonly availableAt?: never;
      readonly publishedAt: string;
      readonly failedAt?: never;
      readonly failureCode?: never;
    })
  | (OutboxMessageBase<TPayload> & {
      readonly status: "failed";
      readonly availableAt?: never;
      readonly publishedAt?: never;
      readonly failedAt: string;
      readonly failureCode: string;
    });
