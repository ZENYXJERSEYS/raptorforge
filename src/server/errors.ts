import { NextResponse } from "next/server";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const Errors = {
  badRequest: (msg = "Invalid request.", details?: unknown) =>
    new ApiError("BAD_REQUEST", msg, 400, details),
  unauthorized: (msg = "Authentication required.") =>
    new ApiError("UNAUTHENTICATED", msg, 401),
  forbidden: (msg = "You do not have permission to perform this action.") =>
    new ApiError("FORBIDDEN", msg, 403),
  notFound: (msg = "Resource not found.") => new ApiError("NOT_FOUND", msg, 404),
  conflict: (msg = "Conflict with existing state.", details?: unknown) =>
    new ApiError("CONFLICT", msg, 409, details),
  unprocessable: (msg: string, details?: unknown) =>
    new ApiError("UNPROCESSABLE", msg, 422, details),
  tooMany: (msg = "Rate limit exceeded. Slow down and try again shortly.") =>
    new ApiError("RATE_LIMITED", msg, 429),
  deadlinePassed: () =>
    new ApiError(
      "SUBMISSION_DEADLINE_PASSED",
      "The submission deadline has passed; submissions are locked.",
      423
    ),
  internal: (msg = "An unexpected error occurred.") =>
    new ApiError("INTERNAL", msg, 500),
};

export type ErrorBody = { error: { code: string; message: string; details?: unknown } };

export function errorBody(err: unknown): { body: ErrorBody; status: number } {
  if (err instanceof ApiError) {
    return {
      body: { error: { code: err.code, message: err.message, details: err.details } },
      status: err.status,
    };
  }
  // Never leak stack traces or internals to clients.
  return {
    body: { error: { code: "INTERNAL", message: "An unexpected error occurred." } },
    status: 500,
  };
}

export function jsonError(err: unknown): NextResponse<ErrorBody> {
  const { body, status } = errorBody(err);
  return NextResponse.json(body, { status });
}

export function jsonOk<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}
