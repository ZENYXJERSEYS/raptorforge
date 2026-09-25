import { z } from "zod";
import { prisma } from "@/server/db";
import { requireJudge } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { computeWeightedScore } from "@/server/judging/scoring";
import { queueWebhook } from "@/server/webhooks";

type Ctx = { params: Promise<{ id: string }> };

const scoreSchema = z.object({
  projectId: z.string().min(1),
  comment: z.string().max(5000).default(""),
  scores: z
    .array(z.object({ criterionId: z.string().min(1), value: z.number().int() }))
    .min(1)
    .max(50),
});

export const POST = handler(async (req, ctx) => {
  const { id: eventId } = await (ctx as Ctx).params;
  const { user } = await requireJudge(req, eventId);
  const body = await parseBody(req, scoreSchema);

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw Errors.notFound("Event not found.");
  if (event.status === "COMPLETED" || event.status === "ARCHIVED") {
    throw Errors.forbidden("Judging is closed for this event.");
  }
  if (event.judgingMode !== "RUBRIC") {
    throw Errors.badRequest("This event uses pairwise judging mode.");
  }

  const judge = await prisma.judge.findUnique({ where: { userId_eventId: { userId: user.id, eventId } } });
  if (!judge) throw Errors.forbidden("Judge profile not found.");

  const assignment = await prisma.judgeAssignment.findUnique({
    where: { judgeId_projectId: { judgeId: judge.id, projectId: body.projectId } },
  });
  if (!assignment) {
    throw Errors.forbidden("You are not assigned to this project.");
  }

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project || project.eventId !== eventId) throw Errors.notFound("Project not found.");
  if (project.status === "DRAFT" || project.status === "DISQUALIFIED") {
    throw Errors.forbidden("This project cannot be judged.");
  }

  const rubric = await prisma.rubric.findUnique({ where: { eventId }, include: { criteria: true } });
  if (!rubric) throw Errors.unprocessable("No rubric configured for this event yet.");
  const criterionById = new Map(rubric.criteria.map((c) => [c.id, c]));

  // validate every submitted score against the rubric
  for (const s of body.scores) {
    const c = criterionById.get(s.criterionId);
    if (!c) throw Errors.badRequest("Unknown criterion submitted.");
    if (s.value < c.minScore || s.value > c.maxScore) {
      throw Errors.badRequest(`Score for "${c.name}" must be between ${c.minScore} and ${c.maxScore}.`);
    }
  }
  const requiredIds = rubric.criteria.filter((c) => c.required).map((c) => c.id);
  const providedIds = new Set(body.scores.map((s) => s.criterionId));
  const missingRequired = requiredIds.filter((cid) => !providedIds.has(cid));
  if (missingRequired.length) {
    throw Errors.unprocessable("Missing scores for required criteria.");
  }

  // server-side weighted score — client scores are never trusted
  const weighted = computeWeightedScore(
    body.scores,
    rubric.criteria.map((c) => ({ criterionId: c.id, weight: c.weight, minScore: c.minScore, maxScore: c.maxScore }))
  );

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.judgement.findUnique({
      where: { judgeId_projectId: { judgeId: judge.id, projectId: body.projectId } },
      include: { scores: true },
    });
    const oldScores = new Map((existing?.scores ?? []).map((s) => [s.criterionId, s.value]));

    const judgement = existing
      ? await tx.judgement.update({
          where: { id: existing.id },
          data: { weightedScore: weighted, comment: body.comment, rubricVersion: rubric.version },
        })
      : await tx.judgement.create({
          data: {
            judgeId: judge.id,
            projectId: body.projectId,
            weightedScore: weighted,
            comment: body.comment,
            rubricVersion: rubric.version,
          },
        });

    // upsert criterion scores + append immutable change history
    for (const s of body.scores) {
      const old = oldScores.get(s.criterionId);
      await tx.criterionScore.upsert({
        where: { judgementId_criterionId: { judgementId: judgement.id, criterionId: s.criterionId } },
        create: { judgementId: judgement.id, criterionId: s.criterionId, value: s.value },
        update: { value: s.value },
      });
      await tx.scoreChange.create({
        data: {
          judgementId: judgement.id,
          criterionId: s.criterionId,
          oldValue: old ?? 0,
          newValue: s.value,
          action: old === undefined ? "CREATED" : "UPDATED",
          actorId: user.id,
        },
      });
    }

    await audit(
      {
        actorId: user.id,
        action: existing ? "JUDGEMENT_UPDATED" : "JUDGEMENT_SUBMITTED",
        resource: "project",
        resourceId: body.projectId,
        metadata: { judgementId: judgement.id, weightedScore: weighted },
      },
      tx
    );
    return { judgement, created: !existing };
  });

  if (result.created) {
    await queueWebhook({
      type: "judgement.completed",
      eventId,
      data: { projectId: body.projectId, judgeId: judge.id },
    });
  }

  return ok({ judgement: result.judgement }, result.created ? 201 : 200);
});

export const GET = handler(async (req, ctx) => {
  const { id: eventId } = await (ctx as Ctx).params;
  const { user } = await requireJudge(req, eventId);
  const judge = await prisma.judge.findUnique({ where: { userId_eventId: { userId: user.id, eventId } } });
  if (!judge) throw Errors.forbidden("Judge profile not found.");
  const judgements = await prisma.judgement.findMany({
    where: { judgeId: judge.id },
    include: { scores: true },
  });
  return ok({ judgements });
});
