import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";

/**
 * Fixed-window counter in Postgres. Keyed per subject (user id, ip hash…).
 * Throws RATE_LIMITED when the window would exceed `limit`.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ count: number; resetAt: Date }> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const row = await prisma.rateLimitCounter.upsert({
    where: { key_window: { key, window: windowStart } },
    create: { key, window: windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (row.count > limit) {
    const resetAt = new Date(windowStart.getTime() + windowMs);
    throw Errors.tooMany(
      `Rate limit exceeded (${limit} per ${Math.round(windowMs / 1000)}s). Try again after ${resetAt.toISOString()}.`
    );
  }
  return { count: row.count, resetAt: new Date(windowStart.getTime() + windowMs) };
}

/** Count without consuming (for heuristic checks). */
export async function peekCount(key: string, windowMs: number): Promise<number> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const row = await prisma.rateLimitCounter.findUnique({
    where: { key_window: { key, window: windowStart } },
  });
  return row?.count ?? 0;
}
