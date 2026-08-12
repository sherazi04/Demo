import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, isAppError } from "./errors";
import { logger } from "./logger";

/**
 * One place where typed errors become HTTP responses, so no route handler
 * invents its own status codes or leaks an internal message to a client.
 */

export interface ErrorBody {
  error: { code: string; message: string; detail?: unknown };
}

export function errorResponse(error: unknown, correlationId?: string): NextResponse<ErrorBody> {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "bad_request",
          message: "Request failed validation",
          detail: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }

  if (isAppError(error)) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, detail: error.detail } },
      { status: error.status },
    );
  }

  // Unknown failures are logged in full but reported opaquely — an internal
  // message could disclose schema or filesystem details (NFR-SEC-004).
  logger.error("unhandled route error", {
    correlationId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return NextResponse.json(
    { error: { code: "internal_error", message: "Internal server error" } },
    { status: 500 },
  );
}

/**
 * Wraps a route handler so every thrown AppError maps to its status.
 * Typed against `Response` rather than `NextResponse` so handlers that stream
 * or return a file download (the CSV template, the SSE generation stream) can
 * use the same wrapper.
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error: unknown) {
      return errorResponse(error);
    }
  };
}

export function json<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

export { AppError };
