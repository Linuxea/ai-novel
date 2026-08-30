import type { PlatformEntrypoint } from "../capabilities";

export const eventsPlatform = {
  name: "events",
  publicPath: "@/platform/events",
} as const satisfies PlatformEntrypoint<"events">;

export { createEventBus } from "./event-bus";
export type {
  EventBus,
  EventHandler,
  EventHandlerContext,
  EventMap,
  EventPublisher,
} from "./event-bus";
export { createOutboxDispatcher } from "./outbox-dispatcher";
export type {
  CreateOutboxDispatcherOptions,
  OutboxDispatcher,
} from "./outbox-dispatcher";
export { createOutboxRepository } from "./outbox-repository";
export type {
  ClaimOutboxOptions,
  EnqueueEventOptions,
  FailOutboxClaimOptions,
  OutboxClaim,
  OutboxRecord,
  OutboxRepository,
  OutboxRepositoryOptions,
  OutboxStatus,
} from "./outbox-repository";
export type {
  LeaseHeartbeat,
  LeaseHeartbeatStartOptions,
} from "../lease-heartbeat";
