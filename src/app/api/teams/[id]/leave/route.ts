import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, ok } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);
  const team = await prisma.team.findUnique({ where: { id }, include: { members: true } });
  if (!team) throw Errors.notFound("Team not found.");

  const membership = team.members.find((m) => m.userId === user.id);
  if (!membership) throw Errors.forbidden("You are not a member of this team.");

  if (team.ownerId === user.id) {
    if (team.members.length > 1) {
      throw Errors.conflict("Owners must transfer ownership before leaving. Ask another member to take over via the organizer console.");
    }
    // sole owner: leaving deletes the team (if no project exists)
    const projectCount = await prisma.project.count({ where: { teamId: team.id } });
    if (projectCount > 0) throw Errors.conflict("Teams with projects cannot be deleted; contact an organizer.");
    await prisma.team.delete({ where: { id: team.id } });
    await audit({ actorId: user.id, action: "TEAM_LEFT", resource: "team", resourceId: team.id, metadata: { deleted: true } });
    return ok({ left: true, deleted: true });
  }

  await prisma.teamMember.delete({ where: { id: membership.id } });
  await audit({ actorId: user.id, action: "TEAM_LEFT", resource: "team", resourceId: team.id });
  return ok({ left: true, deleted: false });
});
