import { env } from "./env";

/**
 * Structured JSON logging with a correlation ID (NFR-OBS-003).
 *
 * Secrets, raw prompts and student PII never pass through here — callers log
 * hashes and identifiers instead (NFR-SEC-004, NFR-SEC-006). `redact()` is a
 * backstop for keys that slip into a payload, not a licence to pass them.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "apikey",
  "api_key",
  "anthropic_api_key",
  "authsecret",
  "auth_secret",
  "secret",
  "token",
  "authorization",
  "prompt",
  "systemprompt",
  "email",
  "response",
  "answer",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export interface LogFields {
  correlationId?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  let threshold: LogLevel = "info";
  try {
    threshold = env.LOG_LEVEL;
  } catch {
    // env not loaded yet (e.g. a unit test) — fall back to info.
  }
  if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;

  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redact(fields) as Record<string, unknown>),
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),

  /** Binds a correlation ID so every downstream line carries it. */
  child(bound: LogFields) {
    return {
      debug: (msg: string, f?: LogFields) => emit("debug", msg, { ...bound, ...f }),
      info: (msg: string, f?: LogFields) => emit("info", msg, { ...bound, ...f }),
      warn: (msg: string, f?: LogFields) => emit("warn", msg, { ...bound, ...f }),
      error: (msg: string, f?: LogFields) => emit("error", msg, { ...bound, ...f }),
    };
  },
};

export type Logger = typeof logger;
