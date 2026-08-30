import type { PlatformEntrypoint } from "../capabilities";

export const observabilityPlatform = {
  name: "observability",
  publicPath: "@/platform/observability",
} as const satisfies PlatformEntrypoint<"observability">;

export {
  createLogger,
  getCorrelationContext,
  jsonLineLogSink,
  sanitizeLogFields,
  withCorrelationContext,
} from "./logger";
export type {
  CorrelationContext,
  CreateLoggerOptions,
  Logger,
  LogLevel,
  LogRecord,
  LogSink,
} from "./logger";
export {
  sanitizeSensitiveData,
  sanitizeSensitiveString,
  serializeSafeError,
} from "./safe-data";
export type { SafeErrorRecord } from "./safe-data";
