import { z } from "zod";
import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { randomToken, sha256Hex } from "@/server/util";

const createSchema = z.object({
  eventId: z.string().min(1),
  name: z.string().min(2).max(60),
});

const inviteSchema = z.object({
  eventId: z.string().min(1),
  teamId: z.string().min(1),
});

export const GET = handler(async (req) => {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) throw Errors.badRequest("eventId query parameter required.");
  const teams = await prisma.team.findMany({
    where: { eventId },
    include: { members: { include: { user: { select: { id: true, name: true } } } }, _count: { select: { projects: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ok({
    teams: teams.map(({ _count, ...t }) => ({
      id: t.id, name: t.name, eventId: t.eventId,
      members: t.members.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role })),
      memberCount: t.members.length,
      hasProject: _count.projects > 0,
    })),
  });
});

export const POST = handler(async (req) => {
  const { user } = await requireAuth(req);
  const body = await parseBody(req, createSchema);

  const event = await prisma.event.findUnique({ where: { id: body.eventId } });
  if (!event) throw Errors.notFound("Event not found.");
  const now = new Date();
  if (now < event.registrationStart || now > event.registrationEnd) {
    throw Errors.forbidden("Registration is not open for this event.");
  }
  if (user.role === "JUDGE") throw Errors.forbidden("Judges cannot create teams.");

  // one team per user per event
  const existing = await prisma.teamMember.findFirst({
    where: { userId: user.id, team: { eventId: body.eventId } },
  });
  if (existing) throw Errors.conflict("You are already on a team for this event.");

  const team = await prisma.$transaction(async (tx) => {
    const t = await tx.team.create({
      data: {
        eventId: body.eventId,
        name: body.name,
        ownerId: user.id,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    await audit({ actorId: user.id, action: "TEAM_CREATED", resource: "team", resourceId: t.id, metadata: { name: t.name, eventId: body.eventId } }, tx);
    return t;
  });

  return ok({ team }, 201);
});

export const PUT = handler(async (req) => {
  // invite-link creation: PUT /api/teams with {eventId, teamId}
  const { user } = await requireAuth(req);
  const body = await parseBody(req, inviteSchema);
  const team = await prisma.team.findUnique({ where: { id: body.teamId } });
  if (!team || team.eventId !== body.eventId) throw Errors.notFound("Team not found.");
  if (team.ownerId !== user.id && user.role !== "ADMIN") {
    throw Errors.forbidden("Only the team owner can create invite links.");
  }
  const token = randomToken(24);
  await prisma.teamInvite.create({
    data: {
      teamId: team.id,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    },
  });
  await audit({ actorId: user.id, action: "INVITE_CREATED", resource: "team", resourceId: team.id });
  return ok({ inviteToken: token, joinUrl: `/join/${token}` }, 201);
});
