type InstrumentationEnvironment = Readonly<
  Record<string, string | undefined>
>;

function workersEnabled(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") {
    return true;
  }
  return !["0", "false", "off", "no"].includes(
    value.trim().toLowerCase(),
  );
}

export function shouldStartPlatformWorkers(
  environment: InstrumentationEnvironment,
): boolean {
  return (
    environment.NEXT_RUNTIME === "nodejs" &&
    environment.NODE_ENV !== "test" &&
    environment.NEXT_PHASE !== "phase-production-build" &&
    workersEnabled(environment.PLATFORM_WORKERS_ENABLED)
  );
}

function workerInterval(
  environment: InstrumentationEnvironment,
): number {
  const value = environment.PLATFORM_WORKER_INTERVAL_MS?.trim();
  if (!value) {
    return 1_000;
  }
  const interval = Number(value);
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new Error(
      "PLATFORM_WORKER_INTERVAL_MS 必须是正安全整数",
    );
  }
  return interval;
}

export async function register(): Promise<void> {
  if (!shouldStartPlatformWorkers(process.env)) {
    return;
  }
  const { startPlatformWorkers } = await import("@/platform/jobs");
  startPlatformWorkers({
    intervalMs: workerInterval(process.env),
  });
}
