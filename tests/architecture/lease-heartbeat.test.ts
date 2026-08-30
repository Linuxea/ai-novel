import { describe, expect, it } from "vitest";
import { createIntervalLeaseHeartbeat } from "@/platform/jobs";

describe("租约 heartbeat", () => {
  it("renewLease 抛错时停止 timer 并只通知一次 lease lost", () => {
    const callbacks: Array<() => void> = [];
    const cleared: unknown[] = [];
    const handle = {};
    let lostNotifications = 0;
    const heartbeat = createIntervalLeaseHeartbeat(100, {
      scheduler: {
        clearInterval(timer) {
          cleared.push(timer);
        },
        setInterval(callback) {
          callbacks.push(callback);
          return handle;
        },
      },
    });
    const stop = heartbeat.start({
      onLeaseLost() {
        lostNotifications += 1;
      },
      renewLease() {
        throw new Error("SQLITE_BUSY");
      },
    });

    expect(() => callbacks[0]?.()).not.toThrow();
    expect(() => callbacks[0]?.()).not.toThrow();
    stop();

    expect(lostNotifications).toBe(1);
    expect(cleared).toEqual([handle]);
  });
});
