import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { handler, ok } from "@/server/api";
import { votingOpen, randomizedProjectOrder, publicVoteCountsVisible } from "@/server/voting";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) throw Errors.notFound("Event not found.");

  const active = votingOpen(event);
  if (!active) {
    throw Errors.forbidden("Voting is not currently open for this event.");
  }

  const order = await randomizedProjectOrder(id, user.id);
  const projects = await prisma.project.findMany({
    where: { id: { in: order } },
    select: { id: true, name: true, shortDescription: true, technologies: true, track: { select: { name: true } }, team: { select: { name: true } } },
  });
  const byId = new Map(projects.map((p) => [p.id, p]));
  const ordered = order.map((pid) => byId.get(pid)).filter(Boolean) as typeof projects;

  const myVotes = await prisma.vote.findMany({
    where: { eventId: id, userId: user.id },
    select: { projectId: true },
  });
  const used = myVotes.length;

  const countsVisible = await publicVoteCountsVisible(id);
  const counts = countsVisible
    ? await prisma.vote.groupBy({ by: ["projectId"], where: { eventId: id }, _count: { id: true } })
    : [];
  const countMap = new Map(counts.map((c) => [c.projectId, c._count.id]));

  return ok({
    voting: {
      active,
      end: event.votingEnd,
      votesPerUser: event.votesPerUser,
      used,
      remaining: Math.max(0, event.votesPerUser - used),
      resultsHidden: event.votingResultsHidden,
      showCounts: countsVisible,
    },
    projects: ordered.map((p) => ({ ...p, votes: countsVisible ? countMap.get(p.id) ?? 0 : null, myVote: myVotes.some((v) => v.projectId === p.id) })),
  });
});
