import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/auth/session";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { enforceRateLimit } from "@/server/ratelimit";
import { handler, parseBody, ok } from "@/server/api";

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, loginSchema);
  const ip = req.headers.get("x-forwarded-for") ?? "local";
  await enforceRateLimit(`login:${ip}`, 30, 60_000);

  const email = body.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;

  if (!user || !valid || user.status !== "ACTIVE") {
    await audit({
      actorId: user?.id ?? null,
      action: "USER_LOGIN_FAILED",
      resource: "user",
      resourceId: user?.id ?? email,
      metadata: { reason: !user ? "unknown-email" : !valid ? "bad-password" : "inactive" },
    });
    throw Errors.unauthorized("Invalid email or password.");
  }

  const { token, expiresAt } = await createSession(user.id);
  await audit({ actorId: user.id, action: "USER_LOGGED_IN", resource: "user", resourceId: user.id });

  const res = ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
});
