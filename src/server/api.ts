import { NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/server/errors";

export type RouteCtx = { params: Promise<Record<string, string>> };
export type ResponseLike = NextResponse | Response;

/**
 * Thin wrapper giving every API route consistent behavior: zod validation,
 * structured errors, no stack traces, correct content types.
 */
export function handler(
  fn: (req: NextRequest, ctx: RouteCtx) => Promise<ResponseLike>
) {
  return async (req: NextRequest, routeCtx: RouteCtx): Promise<Response> => {
    try {
      return await fn(req, routeCtx);
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Request validation failed.",
              details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
            },
          },
          { status: 422 }
        );
      }
      return jsonError(err);
    }
  };
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  return schema.parse(raw) as z.output<S>;
}

export function ok<T>(data: T, status = 200) {
  return jsonOk(data, status);
}

export function isHandlerWrapper(): boolean {
  return true;
}
