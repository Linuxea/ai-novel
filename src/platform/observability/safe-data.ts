const DEFAULT_MAX_STRING_LENGTH = 2_048;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  "[a-z0-9_-]*(?:api[_-]?key|authorization|cookie|password|secret|token)[a-z0-9_-]*";

export interface SafeErrorRecord {
  readonly code?: number | string;
  readonly message: string;
  readonly name: string;
}

function truncate(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) {
    return value;
  }
  const suffix = "…[TRUNCATED]";
  return `${value.slice(0, maximumLength - suffix.length)}${suffix}`;
}

function requireMaximumLength(maximumLength: number): number {
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 64) {
    throw new Error("安全序列化长度必须是不小于 64 的安全整数");
  }
  return maximumLength;
}

export function sanitizeSensitiveString(
  value: string,
  maximumLength = DEFAULT_MAX_STRING_LENGTH,
): string {
  const limit = requireMaximumLength(maximumLength);
  const boundedValue = truncate(value, limit * 4);
  const sanitized = boundedValue
    .replace(
      new RegExp(
        `\\b(set-cookie|cookie)\\s*:\\s*[^\\r\\n]*`,
        "gi",
      ),
      "$1: [REDACTED]",
    )
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi,
      `$1${REDACTED}@`,
    )
    .replace(
      /\bBearer\s+[^\s,;]+/gi,
      `Bearer ${REDACTED}`,
    )
    .replace(
      new RegExp(
        `("(?:${SENSITIVE_KEY_PATTERN})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`,
        "gi",
      ),
      `$1"${REDACTED}"`,
    )
    .replace(
      new RegExp(
        `('(?:${SENSITIVE_KEY_PATTERN})'\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`,
        "gi",
      ),
      `$1'${REDACTED}'`,
    )
    .replace(
      new RegExp(
        `\\b(${SENSITIVE_KEY_PATTERN})\\b(\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;&]+)`,
        "gi",
      ),
      `$1$2${REDACTED}`,
    );
  return truncate(sanitized, limit);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
  return [
    "apikey",
    "authorization",
    "cookie",
    "password",
    "secret",
    "setcookie",
    "token",
  ].some((secret) => normalized.includes(secret));
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (value instanceof Error) {
    return serializeSafeError(value);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeSensitiveString(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = isSensitiveKey(key)
      ? REDACTED
      : sanitizeValue(item, seen);
  }
  return sanitized;
}

export function sanitizeSensitiveData(
  value: unknown,
): unknown {
  return sanitizeValue(value, new WeakSet());
}

export function serializeSafeError(
  error: unknown,
  maximumMessageLength = DEFAULT_MAX_STRING_LENGTH,
): SafeErrorRecord {
  if (error instanceof Error) {
    const code =
      "code" in error &&
      (typeof error.code === "string" ||
        typeof error.code === "number")
        ? error.code
        : undefined;
    return {
      ...(code === undefined
        ? {}
        : {
            code:
              typeof code === "string"
                ? sanitizeSensitiveString(code, 256)
                : code,
          }),
      message: sanitizeSensitiveString(
        error.message,
        maximumMessageLength,
      ),
      name: sanitizeSensitiveString(error.name, 256),
    };
  }
  return {
    message: sanitizeSensitiveString(
      typeof error === "string"
        ? error
        : "未知外部错误",
      maximumMessageLength,
    ),
    name: "Error",
  };
}
