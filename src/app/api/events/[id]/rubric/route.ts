import { z } from "zod";
import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

const criterionSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(""),
  weight: z.number().int().min(1).max(100),
  minScore: z.number().int().min(0).max(100).default(1),
  maxScore: z.number().int().min(1).max(100).default(5),
  required: z.boolean().default(true),
  order: z.number().int().min(0).max(100).default(0),
});

const rubricSchema = z
  .object({
    name: z.string().min(1).max(120),
    criteria: z.array(criterionSchema).min(1).max(20),
  })
  .refine((v) => v.criteria.reduce((a, c) => a + c.weight, 0) === 100, {
    message: "Criterion weights must sum to exactly 100%.",
  })
  .refine((v) => v.criteria.every((c) => c.maxScore > c.minScore), {
    message: "Every criterion needs maxScore greater than minScore.",
  });

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  // judges may read the rubric to score against it; public gets nothing
  await requireEventOrganizer(req, id);
  const rubric = await prisma.rubric.findUnique({
    where: { eventId: id },
    include: { criteria: { orderBy: { order: "asc" } } },
  });
  return ok({ rubric });
});

export const PUT = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, rubricSchema);

  // Warn (audit) if judgements already exist — changing rubric mid-judging
  // bumps the version; old judgements keep their stored weightedScore.
  const existing = await prisma.rubric.findUnique({ where: { eventId: id } });
  const judgedCount = await prisma.judgement.count({ where: { project: { eventId: id } } });
  if (existing && judgedCount > 0) {
    await audit({
      actorId: user.id,
      action: "RUBRIC_CHANGED",
      resource: "rubric",
      resourceId: existing.id,
      metadata: { note: "rubric replaced while judgements existed; stored scores retained" },
    });
  }

  const rubric = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.rubricCriterion.deleteMany({ where: { rubricId: existing.id } });
      await tx.rubric.delete({ where: { id: existing.id } });
    }
    const r = await tx.rubric.create({
      data: {
        eventId: id,
        name: body.name,
        version: (existing?.version ?? 0) + 1,
        criteria: {
          create: body.criteria.map((c, i) => ({
            name: c.name,
            description: c.description,
            weight: c.weight,
            minScore: c.minScore,
            maxScore: c.maxScore,
            required: c.required,
            order: c.order ?? i,
          })),
        },
      },
      include: { criteria: true },
    });
    await audit({ actorId: user.id, action: "RUBRIC_CHANGED", resource: "rubric", resourceId: r.id, metadata: { version: r.version, criteria: body.criteria.length } }, tx);
    return r;
  });

  return ok({ rubric }, 201);
});
