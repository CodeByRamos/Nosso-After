/**
 * Application errors carry a stable machine code + an HTTP status.
 * Messages are safe to show to end users (Portuguese); internals go to logs only.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SOLD_OUT"
  | "SALES_CLOSED"
  | "LIMIT_EXCEEDED"
  | "ORDER_EXPIRED"
  | "INVALID_STATE"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "PAYMENT_PROVIDER_ERROR"
  | "PAYMENT_DECLINED"
  | "INVALID_SIGNATURE"
  | "NOT_SUPPORTED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SOLD_OUT: 409,
  SALES_CLOSED: 409,
  LIMIT_EXCEEDED: 409,
  ORDER_EXPIRED: 409,
  INVALID_STATE: 409,
  IDEMPOTENCY_MISMATCH: 422,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PAYMENT_PROVIDER_ERROR: 502,
  PAYMENT_DECLINED: 402,
  INVALID_SIGNATURE: 401,
  NOT_SUPPORTED: 501,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
