import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { handler, ok } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  await requireEventOrganizer(req, id);

  const flagged = await prisma.vote.findMany({
    where: { eventId: id, flagLevel: { not: "NORMAL" } },
    include: { user: { select: { id: true, name: true, email: true } }, project: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const byUser = await prisma.vote.groupBy({
    by: ["userId"],
    where: { eventId: id },
    _count: { id: true },
    _max: { createdAt: true },
    _min: { createdAt: true },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: byUser.map((u) => u.userId) } },
    select: { id: true, name: true, email: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  // velocity: votes-per-minute span for users with >1 vote
  const velocity = byUser
    .map((u) => {
      const spanMs =
        u._max.createdAt && u._min.createdAt ? u._max.createdAt.getTime() - u._min.createdAt.getTime() : 0;
      const spanMin = Math.max(spanMs / 60000, 1 / 60);
      return {
        user: userById.get(u.userId) ?? { id: u.userId, name: "unknown", email: "" },
        votes: u._count.id,
        spanMinutes: Math.round(spanMin * 100) / 100,
        votesPerMinute: Math.round((u._count.id / spanMin) * 100) / 100,
        level:
          u._count.id / spanMin > 15 ? "CRITICAL" : u._count.id / spanMin > 6 ? "SUSPICIOUS" : "NORMAL",
      };
    })
    .sort((a, b) => b.votesPerMinute - a.votesPerMinute)
    .slice(0, 25);

  const counts = await prisma.vote.groupBy({ by: ["flagLevel"], where: { eventId: id }, _count: { id: true } });
  const flagCounts = Object.fromEntries(counts.map((c) => [c.flagLevel, c._count.id]));

  return ok({
    summary: {
      totalVotes: byUser.reduce((a, u) => a + u._count.id, 0),
      flagCounts,
      note:
        "Flags are heuristic indicators of unusual velocity, not proof of fraud. Review before acting — see THREAT-MODEL.md.",
    },
    flagged: flagged.map((f) => ({
      id: f.id,
      createdAt: f.createdAt,
      flagLevel: f.flagLevel,
      flagReason: f.flagReason,
      user: { id: f.user.id, name: f.user.name },
      project: f.project.name,
    })),
    velocity,
  });
});
