import type { EventEnvelope } from "@/shared/contracts";

export type EventMap = Record<string, unknown>;

export interface EventHandlerContext {
  readonly attempt: number;
  readonly fencingToken: string;
  readonly signal: AbortSignal;
}

export type EventHandler<TPayload> = (
  envelope: EventEnvelope<TPayload>,
  context: EventHandlerContext,
) => void | Promise<void>;

export interface EventPublisher {
  eventNames(): readonly string[];
  hasHandlers(): boolean;
  publishEnvelope(
    envelope: EventEnvelope,
    context?: EventHandlerContext,
  ): Promise<void>;
}

export interface EventBus<TEvents extends EventMap> extends EventPublisher {
  publish<TKey extends keyof TEvents & string>(
    eventName: TKey,
    envelope: EventEnvelope<TEvents[TKey]>,
  ): Promise<void>;
  subscribe<TKey extends keyof TEvents & string>(
    eventName: TKey,
    handler: EventHandler<TEvents[TKey]>,
  ): () => void;
}

export function createEventBus<
  TEvents extends EventMap = EventMap,
>(): EventBus<TEvents> {
  const handlers = new Map<
    string,
    Set<EventHandler<unknown>>
  >();

  async function publishEnvelope(
    envelope: EventEnvelope,
    context: EventHandlerContext = {
      attempt: 1,
      fencingToken: envelope.eventId,
      signal: new AbortController().signal,
    },
  ): Promise<void> {
    const eventHandlers = handlers.get(envelope.eventName);
    if (!eventHandlers) {
      return;
    }

    for (const handler of [...eventHandlers]) {
      await handler(envelope, context);
    }
  }

  return {
    eventNames() {
      return [...handlers.keys()];
    },
    hasHandlers() {
      return handlers.size > 0;
    },
    publish(eventName, envelope) {
      if (String(eventName) !== envelope.eventName) {
        throw new Error("发布事件名与信封事件名不一致");
      }
      return publishEnvelope(envelope);
    },
    publishEnvelope,
    subscribe(eventName, handler) {
      let eventHandlers = handlers.get(eventName);
      if (!eventHandlers) {
        eventHandlers = new Set();
        handlers.set(eventName, eventHandlers);
      }
      const untypedHandler =
        handler as EventHandler<unknown>;
      eventHandlers.add(untypedHandler);

      let subscribed = true;
      return () => {
        if (!subscribed) {
          return;
        }
        subscribed = false;
        eventHandlers.delete(untypedHandler);
        if (eventHandlers.size === 0) {
          handlers.delete(eventName);
        }
      };
    },
  };
}
