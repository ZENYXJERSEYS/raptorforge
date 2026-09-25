import type { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { requireUser, sessionUserOrNull } from "@/server/auth/session";
import type { Role, User } from "@prisma/client";

export interface AuthContext {
  user: User;
  token: string;
}

/** Authenticate the request and return the user + session token. */
export async function requireAuth(req: NextRequest): Promise<AuthContext> {
  const token = req.cookies.get("rf_session")?.value;
  const user = await requireUser(token);
  return { user, token: token! };
}

/** Require the global account role to be one of the given roles. */
export async function requireRole(req: NextRequest, roles: Role[]): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  if (!roles.includes(ctx.user.role)) {
    throw Errors.forbidden(`This action requires role: ${roles.join(" or ")}.`);
  }
  return ctx;
}

export async function requireAdmin(req: NextRequest): Promise<AuthContext> {
  return requireRole(req, ["ADMIN"]);
}

/** Require a global role OR an EventOrganizer record for the event. */
export async function requireEventOrganizer(
  req: NextRequest,
  eventId: string
): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  if (ctx.user.role === "ADMIN") return ctx;
  const org = await prisma.eventOrganizer.findUnique({
    where: { eventId_userId: { eventId, userId: ctx.user.id } },
  });
  if (!org) throw Errors.forbidden("Organizer access required for this event.");
  return ctx;
}

/** Require membership (any role) on the given team. */
export async function requireTeamMember(req: NextRequest, teamId: string): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: ctx.user.id } },
  });
  if (!member) throw Errors.forbidden("You are not a member of this team.");
  return ctx;
}

/** Require an ACTIVE judge profile for the event. */
export async function requireJudge(req: NextRequest, eventId: string): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  const judge = await prisma.judge.findUnique({
    where: { userId_eventId: { userId: ctx.user.id, eventId } },
  });
  if (!judge || judge.status !== "ACTIVE") {
    throw Errors.forbidden("Active judge access required for this event.");
  }
  return ctx;
}

export async function isEventOrganizer(userId: string, eventId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.role === "ADMIN") return true;
  const org = await prisma.eventOrganizer.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  return !!org;
}

export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const m = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  return !!m;
}

export { sessionUserOrNull };
