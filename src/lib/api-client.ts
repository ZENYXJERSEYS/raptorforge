"use client";

/** Client fetch helper: unwraps the structured error envelope into thrown Errors. */
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let code = "REQUEST_FAILED";
    let message = `Request failed (${res.status})`;
    let details: unknown;
    try {
      const j = await res.json();
      code = j?.error?.code ?? code;
      message = j?.error?.message ?? message;
      details = j?.error?.details;
    } catch {
      /* non-JSON error */
    }
    const err = new Error(message) as Error & { code?: string; details?: unknown };
    err.code = code;
    err.details = details;
    throw err;
  }
  return (await res.json()) as T;
}
