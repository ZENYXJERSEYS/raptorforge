import { z } from "zod";
import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { computeAssignments } from "@/server/judging/assignment";

type Ctx = { params: Promise<{ id: string }> };

const generateSchema = z.object({
  seed: z.number().int().optional(),
  judgesPerProject: z.number().int().min(1).max(20).optional(),
  replace: z.boolean().default(true),
});

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  await requireEventOrganizer(req, id);
  const assignments = await prisma.judgeAssignment.findMany({
    where: { project: { eventId: id } },
    include: {
      judge: { include: { user: { select: { name: true, email: true } } } },
      project: { select: { id: true, name: true, team: { select: { name: true } }, track: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const judged = await prisma.judgement.findMany({
    where: { project: { eventId: id } },
    select: { judgeId: true, projectId: true },
  });
  const judgedSet = new Set(judged.map((j) => `${j.judgeId}:${j.projectId}`));
  return ok({
    assignments: assignments.map((a) => ({
      id: a.id,
      judge: { id: a.judge.id, name: a.judge.user.name, email: a.judge.user.email },
      project: { id: a.project.id, name: a.project.name, team: a.project.team.name, track: a.project.track?.name ?? null },
      reason: a.reason,
      judged: judgedSet.has(`${a.judge.id}:${a.project.id}`),
    })),
  });
});

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, generateSchema);

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) throw Errors.notFound("Event not found.");

  const projects = await prisma.project.findMany({
    where: { eventId: id, status: { in: ["SUBMITTED", "LOCKED"] } },
    include: { team: { include: { members: { select: { userId: true } } } } },
  });
  const judges = await prisma.judge.findMany({ where: { eventId: id }, include: { user: true } });
  if (judges.length === 0) throw Errors.unprocessable("Add active judges before generating assignments.");
  if (projects.length === 0) throw Errors.unprocessable("No submitted projects to assign.");

  const tracks = await prisma.track.findMany({ where: { eventId: id } });
  const trackExpertise: Record<string, string[]> = {};
  for (const t of tracks) {
    trackExpertise[t.id] = t.name.toLowerCase().split(/[\s,-]+/).filter(Boolean);
  }

  const result = computeAssignments({
    projects: projects.map((p) => ({
      id: p.id,
      teamId: p.teamId,
      trackId: p.trackId,
      memberUserIds: p.team.members.map((m) => m.userId),
    })),
    judges: judges.map((j) => ({ id: j.id, userId: j.userId, expertise: j.expertise, active: j.status === "ACTIVE" })),
    judgesPerProject: body.judgesPerProject ?? event.judgesPerProject,
    trackExpertise,
    seed: body.seed ?? event.assignmentSeed,
  });

  const counts = await prisma.$transaction(async (tx) => {
    if (body.replace) {
      // replace the whole assignment set atomically (see ARCHITECTURE.md)
      await tx.judgeAssignment.deleteMany({ where: { project: { eventId: id } } });
    }
    await tx.judgeAssignment.createMany({
      data: result.decisions.map((d) => ({ judgeId: d.judgeId, projectId: d.projectId, reason: d.reason })),
      skipDuplicates: true,
    });
    await audit(
      {
        actorId: user.id,
        action: "ASSIGNMENTS_GENERATED",
        resource: "event",
        resourceId: id,
        metadata: {
          decisions: result.decisions.length,
          unassigned: result.unassigned.length,
          seed: body.seed ?? event.assignmentSeed,
        },
      },
      tx
    );
    return result.decisions.length;
  });

  return ok({ created: counts, unassigned: result.unassigned, load: result.load }, 201);
});
