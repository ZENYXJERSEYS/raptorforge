import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { handler, ok } from "@/server/api";

export const GET = handler(async (req) => {
  const { user } = await requireAuth(req);
  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    include: { team: { select: { id: true, name: true, eventId: true } } },
  });
  const judgeProfiles = await prisma.judge.findMany({
    where: { userId: user.id },
    select: { id: true, eventId: true, status: true },
  });
  const organizing = await prisma.eventOrganizer.findMany({
    where: { userId: user.id },
    select: { eventId: true },
  });
  return ok({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status },
    memberships: memberships.map((m) => m.team),
    judgeProfiles,
    organizingEventIds: organizing.map((o) => o.eventId),
  });
});
