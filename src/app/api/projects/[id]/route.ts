import { prisma } from "@/server/db";
import { requireAuth, sessionUserOrNull } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { handler, ok } from "@/server/api";
import { votingOpen } from "@/server/voting";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      track: { select: { name: true, slug: true } },
      team: { include: { members: { include: { user: { select: { id: true, name: true } } } } } },
      event: { select: { id: true, name: true, slug: true, votingEnabled: true, votingStart: true, votingEnd: true, votingResultsHidden: true, votesPerUser: true } },
    },
  });
  if (!project) throw Errors.notFound("Project not found.");
  if (project.status === "DRAFT" || project.status === "DISQUALIFIED") {
    throw Errors.notFound("Project not found.");
  }

  const user = await sessionUserOrNull(req.cookies.get("rf_session")?.value);
  const comments = await prisma.comment.findMany({
    where: { projectId: id, isHidden: false },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const votingActive = votingOpen(project.event);
  const resultsVisible = !project.event.votingResultsHidden || !votingActive;
  let votes = 0;
  let myVote = false;
  if (resultsVisible) {
    votes = await prisma.vote.count({ where: { projectId: id } });
  }
  if (user) {
    const v = await prisma.vote.findUnique({ where: { userId_projectId: { userId: user.id, projectId: id } } });
    myVote = !!v;
  }

  return ok({
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      shortDescription: project.shortDescription,
      fullDescription: project.fullDescription,
      repositoryUrl: project.repositoryUrl,
      demoUrl: project.demoUrl,
      videoUrl: project.videoUrl,
      technologies: project.technologies,
      status: project.status,
      submittedAt: project.submittedAt,
      track: project.track,
      team: { name: project.team.name, members: project.team.members.map((m) => ({ id: m.user.id, name: m.user.name })) },
      event: { id: project.event.id, name: project.event.name, slug: project.event.slug },
    },
    comments: comments.map((c) => ({ id: c.id, body: c.body, author: c.author.name, createdAt: c.createdAt, canDelete: user?.id === c.author.id })),
    voting: { active: votingActive, resultsVisible, votes: resultsVisible ? votes : null, myVote },
  });
});
