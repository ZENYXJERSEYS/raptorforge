import { prisma } from "@/server/db";
import { destroySession, SESSION_COOKIE } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { handler, ok } from "@/server/api";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

export const POST = handler(async (req) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const rec = await prisma.session
      .findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } })
      .catch(() => null);
    await destroySession(token);
    if (rec) {
      await audit({ actorId: rec.userId, action: "USER_LOGGED_OUT", resource: "user", resourceId: rec.userId });
    }
  }
  const res = ok({ success: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", expires: new Date(0) });
  return res;
});
