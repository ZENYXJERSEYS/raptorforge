import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { ApiError, Errors } from "@/server/errors";
import type { User } from "@prisma/client";

export const SESSION_COOKIE = "rf_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const RENEW_THRESHOLD_MS = 1000 * 60 * 60 * 24; // rotate when < 24h left

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Enable behind TLS in real deployments (COOKIE_SECURE=true). Left off by
    // default so the offline docker-compose demo works over http://localhost.
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires,
  };
}

/** Create a session for a user; returns the raw token (put it in a cookie). */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

/**
 * Resolve the current user from a session token. Extends (rotates) sessions
 * that are close to expiry. Throws UNAUTHENTICATED when missing/expired.
 */
export async function requireUser(token: string | undefined): Promise<User> {
  if (!token) throw Errors.unauthorized();
  const rec = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!rec) throw Errors.unauthorized();
  if (rec.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: rec.id } }).catch(() => {});
    throw Errors.unauthorized("Session expired. Please sign in again.");
  }
  if (rec.user.status !== "ACTIVE") throw Errors.unauthorized("Account is deactivated.");

  if (rec.expiresAt.getTime() - Date.now() < RENEW_THRESHOLD_MS) {
    const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.update({ where: { id: rec.id }, data: { expiresAt: newExpiry } });
  }
  return rec.user;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function sessionUserOrNull(token: string | undefined): Promise<User | null> {
  try {
    return await requireUser(token);
  } catch {
    return null;
  }
}

export { ApiError };
