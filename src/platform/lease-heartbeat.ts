export interface LeaseHeartbeatStartOptions {
  readonly onLeaseLost: () => void;
  readonly renewLease: () => boolean;
}

export interface LeaseHeartbeat {
  start(options: LeaseHeartbeatStartOptions): () => void;
}

export interface LeaseHeartbeatTimerHandle {
  unref?(): void;
}

export interface LeaseHeartbeatScheduler {
  clearInterval(handle: unknown): void;
  setInterval(
    callback: () => void,
    intervalMs: number,
  ): LeaseHeartbeatTimerHandle;
}

export interface CreateIntervalLeaseHeartbeatOptions {
  readonly scheduler?: LeaseHeartbeatScheduler;
}

export function createIntervalLeaseHeartbeat(
  intervalMs: number,
  options: CreateIntervalLeaseHeartbeatOptions = {},
): LeaseHeartbeat {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error("租约 heartbeat 间隔必须是正安全整数");
  }
  const scheduler = options.scheduler ?? {
    clearInterval(handle) {
      globalThis.clearInterval(
        handle as ReturnType<typeof globalThis.setInterval>,
      );
    },
    setInterval(callback, delay) {
      return globalThis.setInterval(callback, delay);
    },
  };

  return {
    start(options) {
      let stopped = false;
      const handle = scheduler.setInterval(() => {
        if (stopped) {
          return;
        }
        let renewed = false;
        try {
          renewed = options.renewLease();
        } catch {
          renewed = false;
        }
        if (!renewed) {
          stopped = true;
          scheduler.clearInterval(handle);
          options.onLeaseLost();
        }
      }, intervalMs);
      handle.unref?.();
      return () => {
        if (stopped) {
          return;
        }
        stopped = true;
        scheduler.clearInterval(handle);
      };
    },
  };
}
