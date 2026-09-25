import { z } from "zod";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/auth/session";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { enforceRateLimit } from "@/server/ratelimit";
import { handler, parseBody, ok } from "@/server/api";
import { NextResponse } from "next/server";

const registerSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, registerSchema);
  await enforceRateLimit(`register:${req.headers.get("x-forwarded-for") ?? "local"}`, 20, 60_000);

  const email = body.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw Errors.conflict("An account with this email already exists.");

  const user = await prisma.user.create({
    data: { email, name: body.name, role: "PARTICIPANT", passwordHash: await hashPassword(body.password) },
  });

  const { token, expiresAt } = await createSession(user.id);
  await audit({ actorId: user.id, action: "USER_CREATED", resource: "user", resourceId: user.id, metadata: { email } });
  await audit({ actorId: user.id, action: "USER_LOGGED_IN", resource: "user", resourceId: user.id });

  const res = ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
});
