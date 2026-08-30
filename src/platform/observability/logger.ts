import { AsyncLocalStorage } from "node:async_hooks";
import {
  sanitizeSensitiveData,
  sanitizeSensitiveString,
} from "./safe-data";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface CorrelationContext {
  readonly changeSetId?: string;
  readonly generationId?: string;
  readonly jobId?: string;
  readonly requestId?: string;
}

export interface LogRecord extends CorrelationContext {
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(
    message: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void;
  error(
    message: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void;
  info(
    message: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void;
  warn(
    message: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void;
}

export interface CreateLoggerOptions {
  readonly clock?: () => Date;
  readonly sink?: LogSink;
}

const correlationStorage =
  new AsyncLocalStorage<CorrelationContext>();

export function sanitizeLogFields(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return sanitizeSensitiveData(fields) as Readonly<
    Record<string, unknown>
  >;
}

export function getCorrelationContext():
  | CorrelationContext
  | undefined {
  return correlationStorage.getStore();
}

export function withCorrelationContext<TResult>(
  context: CorrelationContext,
  operation: () => TResult,
): TResult {
  return correlationStorage.run(
    {
      ...getCorrelationContext(),
      ...context,
    },
    operation,
  );
}

export const jsonLineLogSink: LogSink = (record) => {
  const line = `${JSON.stringify(record)}\n`;
  if (record.level === "error" || record.level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
};

export function createLogger(
  options: CreateLoggerOptions = {},
): Logger {
  const clock = options.clock ?? (() => new Date());
  const sink = options.sink ?? jsonLineLogSink;

  function write(
    level: LogLevel,
    message: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void {
    const context = getCorrelationContext();
    sink({
      ...context,
      ...(fields ? { fields: sanitizeLogFields(fields) } : {}),
      level,
      message: sanitizeSensitiveString(message),
      timestamp: clock().toISOString(),
    });
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    error: (message, fields) => write("error", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
  };
}
