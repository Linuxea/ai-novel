export type ErrorKind =
  | "validation"
  | "not_found"
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "internal";

export interface ApplicationError {
  readonly code: string;
  readonly kind: ErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly causeId?: string;
}

export type Result<TValue, TError extends ApplicationError = ApplicationError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError };
