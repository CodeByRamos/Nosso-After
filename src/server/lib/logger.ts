import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Structured JSON logger with mandatory redaction.
 * NEVER log: PAN, CVV, secrets, tokens, passwords. Keys matching SENSITIVE_KEY are replaced.
 */
type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  request_id?: string;
  user_id?: string;
  order_id?: string;
  payment_id?: string;
  provider_transaction_id?: string;
  [key: string]: unknown;
}

const storage = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  const parent = storage.getStore() ?? {};
  return storage.run({ ...parent, ...ctx }, fn);
}

export function currentLogContext(): LogContext {
  return storage.getStore() ?? {};
}

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|card_?number|pan$|cvv|cvc|security_?code|access_?key|api_?key|signature/i;
const DOCUMENT_KEY = /^(document|cpf|cnpj|identification_number)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 5).join("\n") };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) out[k] = "[REDACTED]";
      else if (DOCUMENT_KEY.test(k) && typeof v === "string") out[k] = maskDocument(v);
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    // Defense in depth: mask anything that looks like a card number (13-19 digits).
    return value.replace(/\b(?:\d[ -]?){13,19}\b/g, "[REDACTED_PAN]");
  }
  return value;
}

export function maskDocument(doc: string) {
  const digits = doc.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-2)}`;
}

function minLevel(): number {
  const l = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return LEVELS[l] ?? LEVELS.info;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < minLevel()) return;
  if (process.env.APP_ENV === "test" && level !== "error" && !process.env.LOG_IN_TESTS) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(redact(currentLogContext()) as object),
    ...(fields ? (redact(fields) as object) : {}),
  };
  const out = JSON.stringify(line);
  if (level === "error" || level === "warn") console.error(out);
  else console.log(out);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
