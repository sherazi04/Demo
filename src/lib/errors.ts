/**
 * Typed error classes. Bare strings are never thrown anywhere in this codebase —
 * route handlers map these onto status codes in `src/lib/http.ts`.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(message: string, opts: { status: number; code: string; detail?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

/** The LLM returned output that would not validate against its Zod schema after all retries (FR-INT-053). */
export class SchemaViolationError extends AppError {
  constructor(message: string, detail?: unknown) {
    super(message, { status: 502, code: "schema_violation", detail });
  }
}

/** An item failed the validation engine and enforcement is on (FR-VAL-010). */
export class ValidationBlockedError extends AppError {
  constructor(message: string, detail?: unknown) {
    super(message, { status: 409, code: "validation_blocked", detail });
  }
}

/** RBAC denial — always paired with an audit record (FR-GOV-008). */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", detail?: unknown) {
    super(message, { status: 403, code: "forbidden", detail });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, { status: 401, code: "unauthorized" });
  }
}

/** A named ingestion stage failed; the stage is retryable without re-upload (NFR-REL-001). */
export class IngestStageError extends AppError {
  readonly stage: string;

  constructor(stage: string, message: string, detail?: unknown) {
    super(message, { status: 500, code: "ingest_stage_failed", detail });
    this.stage = stage;
  }
}

/** A generated artifact referenced a topic or CLO outside the curriculum spine (FR-VAL-007). */
export class DriftError extends AppError {
  constructor(message: string, detail?: unknown) {
    super(message, { status: 422, code: "curriculum_drift", detail });
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Resource") {
    super(`${what} not found`, { status: 404, code: "not_found" });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, detail?: unknown) {
    super(message, { status: 409, code: "conflict", detail });
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, detail?: unknown) {
    super(message, { status: 400, code: "bad_request", detail });
  }
}

/**
 * The model declined to answer. This is a normal HTTP 200 outcome on the
 * Anthropic API (stop_reason === "refusal"), surfaced rather than thrown at the
 * call site — this class exists only for the paths that must abort (FR-INT-055).
 */
export class ModelRefusalError extends AppError {
  constructor(message = "The model declined to produce this output") {
    super(message, { status: 422, code: "model_refusal" });
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
