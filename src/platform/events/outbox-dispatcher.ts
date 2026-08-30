import type { EventPublisher } from "./event-bus";
import type { OutboxRepository } from "./outbox-repository";
import {
  createIntervalLeaseHeartbeat,
  type LeaseHeartbeat,
} from "../lease-heartbeat";

export interface OutboxDispatcher {
  dispatchOnce(signal?: AbortSignal): Promise<boolean>;
}

export interface CreateOutboxDispatcherOptions {
  readonly backoff?: (attempt: number) => number;
  readonly bus: EventPublisher;
  readonly classifyFailure?: (error: unknown) => string;
  readonly heartbeat?: LeaseHeartbeat;
  readonly leaseDurationMs: number;
  readonly repository: OutboxRepository;
  readonly workerId: string;
}

function defaultBackoff(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export function createOutboxDispatcher(
  options: CreateOutboxDispatcherOptions,
): OutboxDispatcher {
  const backoff = options.backoff ?? defaultBackoff;
  const classifyFailure =
    options.classifyFailure ?? (() => "handler_error");
  const heartbeat =
    options.heartbeat ??
    createIntervalLeaseHeartbeat(
      Math.max(1, Math.floor(options.leaseDurationMs / 3)),
    );

  return {
    async dispatchOnce(externalSignal) {
      if (externalSignal?.aborted) {
        return false;
      }
      if (!options.bus.hasHandlers()) {
        return false;
      }
      const eventNames = options.bus.eventNames();
      const claim = options.repository.claimNext({
        eventNames,
        leaseDurationMs: options.leaseDurationMs,
        workerId: options.workerId,
      });
      if (!claim) {
        return false;
      }

      const controller = new AbortController();
      let leaseLost = false;
      const abortFromExternal = () => {
        if (!controller.signal.aborted) {
          controller.abort(externalSignal?.reason);
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
      const stopHeartbeat = heartbeat.start({
        onLeaseLost() {
          leaseLost = true;
          if (!controller.signal.aborted) {
            controller.abort(new Error("outbox_lease_lost"));
          }
        },
        renewLease: () =>
          options.repository.renewLease(
            claim,
            options.leaseDurationMs,
          ),
      });

      try {
        await options.bus.publishEnvelope(
          claim.record.envelope,
          {
            attempt: claim.record.attempts,
            fencingToken: claim.leaseToken,
            signal: controller.signal,
          },
        );
        if (
          !leaseLost &&
          !options.repository.markPublished(claim)
        ) {
          leaseLost = true;
          controller.abort(new Error("outbox_lease_lost"));
        }
      } catch (error) {
        if (!leaseLost) {
          const failed = options.repository.failClaim(claim, {
            backoffMs: backoff(claim.record.attempts),
            error,
            failureCode: classifyFailure(error),
          });
          if (!failed && !controller.signal.aborted) {
            controller.abort(new Error("outbox_lease_lost"));
          }
        }
      } finally {
        stopHeartbeat();
        externalSignal?.removeEventListener(
          "abort",
          abortFromExternal,
        );
      }
      return true;
    },
  };
}
