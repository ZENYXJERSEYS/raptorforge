import { prisma } from "@/server/db";
import { requireJudge } from "@/server/auth/rbac";
import { handler, ok } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireJudge(req, id);

  const judge = await prisma.judge.findUnique({
    where: { userId_eventId: { userId: user.id, eventId: id } },
    include: {
      assignments: {
        include: {
          project: {
            include: {
              team: { select: { name: true } },
              track: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!judge) throw new Error("unreachable");

  const myJudgements = await prisma.judgement.findMany({
    where: { judgeId: judge.id },
    select: { projectId: true, weightedScore: true },
  });
  const judgedMap = new Map(myJudgements.map((j) => [j.projectId, j.weightedScore]));

  const items = judge.assignments.map((a) => ({
    assignmentId: a.id,
    project: {
      id: a.project.id,
      name: a.project.name,
      shortDescription: a.project.shortDescription,
      fullDescription: a.project.fullDescription,
      team: a.project.team.name,
      track: a.project.track?.name ?? null,
      technologies: a.project.technologies,
      repositoryUrl: a.project.repositoryUrl,
      demoUrl: a.project.demoUrl,
      videoUrl: a.project.videoUrl,
    },
    judged: judgedMap.has(a.project.id),
    myWeightedScore: judgedMap.get(a.project.id) ?? null,
  }));

  const completed = items.filter((i) => i.judged).length;
  return ok({
    queue: items,
    progress: {
      assigned: items.length,
      completed,
      remaining: items.length - completed,
      percent: items.length === 0 ? 100 : Math.round((completed / items.length) * 100),
      deadline: null as string | null,
    },
  });
});
