import { z } from "zod";
import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { sha256Hex } from "@/server/util";

const joinSchema = z.object({ token: z.string().min(10).max(200) });

export const POST = handler(async (req) => {
  const { user } = await requireAuth(req);
  const body = await parseBody(req, joinSchema);

  const invite = await prisma.teamInvite.findUnique({
    where: { tokenHash: sha256Hex(body.token) },
    include: { team: { include: { members: true } } },
  });
  if (!invite || invite.status !== "PENDING") {
    throw Errors.notFound("This invite link is invalid or was revoked.");
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw Errors.forbidden("This invite link has expired.");
  }
  const event = await prisma.event.findUnique({ where: { id: invite.team.eventId } });
  if (!event) throw Errors.notFound("Event not found.");
  const now = new Date();
  if (now < event.registrationStart || now > event.registrationEnd) {
    throw Errors.forbidden("Registration is not open for this event.");
  }
  if (user.role === "JUDGE") throw Errors.forbidden("Judges cannot join teams.");

  const alreadyOnTeam = await prisma.teamMember.findFirst({
    where: { userId: user.id, team: { eventId: invite.team.eventId } },
  });
  if (alreadyOnTeam) throw Errors.conflict("You are already on a team for this event.");

  if (invite.team.members.length >= event.maxTeamSize) {
    throw Errors.forbidden(`Team is full (max ${event.maxTeamSize}).`);
  }

  const membership = await prisma.$transaction(async (tx) => {
    const m = await tx.teamMember.create({
      data: { teamId: invite.teamId, userId: user.id, role: "MEMBER" },
    });
    await tx.teamInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", usedBy: user.id },
    });
    await audit(
      { actorId: user.id, action: "TEAM_JOINED", resource: "team", resourceId: invite.teamId, metadata: { teamName: invite.team.name } },
      tx
    );
    return m;
  });

  return ok({ membership, team: { id: invite.team.id, name: invite.team.name } }, 201);
});
