import { z } from "zod";
import { prisma } from "@/server/db";
import { requireEventOrganizer, requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  expertise: z.array(z.string().max(40)).max(20).default([]),
});

const statusSchema = z.object({
  judgeId: z.string().min(1),
  status: z.enum(["INVITED", "ACTIVE", "DEACTIVATED"]),
});

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  await requireEventOrganizer(req, id);
  const judges = await prisma.judge.findMany({
    where: { eventId: id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      assignments: { select: { projectId: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const completed = await prisma.judgement.groupBy({
    by: ["judgeId"],
    where: { project: { eventId: id } },
    _count: { id: true },
  });
  const completedByJudge = new Map(completed.map((c) => [c.judgeId, c._count.id]));
  return ok({
    judges: judges.map((j) => ({
      id: j.id,
      name: j.user.name,
      email: j.user.email,
      userId: j.userId,
      status: j.status,
      expertise: j.expertise,
      assigned: j.assignments.length,
      completed: completedByJudge.get(j.id) ?? 0,
      fallingBehind:
        j.status === "ACTIVE" &&
        j.assignments.length > 0 &&
        (completedByJudge.get(j.id) ?? 0) < Math.ceil(j.assignments.length / 2),
    })),
  });
});

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, createSchema);

  const email = body.email.toLowerCase();
  let judgeUser = await prisma.user.findUnique({ where: { email } });
  if (!judgeUser) {
    judgeUser = await prisma.user.create({
      data: {
        email,
        name: body.name,
        role: "JUDGE",
        passwordHash: await (await import("@/server/auth/password")).hashPassword("change-me-on-first-login"),
      },
    });
    await audit({ actorId: user.id, action: "USER_CREATED", resource: "user", resourceId: judgeUser.id, metadata: { email, via: "judge-invite" } });
  }
  const dupe = await prisma.judge.findUnique({ where: { userId_eventId: { userId: judgeUser.id, eventId: id } } });
  if (dupe) throw Errors.conflict("This user is already a judge for the event.");

  const judge = await prisma.judge.create({
    data: { userId: judgeUser.id, eventId: id, status: "INVITED", expertise: body.expertise },
  });
  await audit({ actorId: user.id, action: "JUDGE_CREATED", resource: "judge", resourceId: judge.id, metadata: { email } });
  return ok({ judge: { id: judge.id, userId: judgeUser.id, status: judge.status } }, 201);
});

export const PATCH = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, statusSchema);
  const judge = await prisma.judge.findUnique({ where: { id: body.judgeId } });
  if (!judge || judge.eventId !== id) throw Errors.notFound("Judge not found on this event.");
  const updated = await prisma.judge.update({ where: { id: body.judgeId }, data: { status: body.status } });
  await audit({ actorId: user.id, action: "JUDGE_STATUS_CHANGED", resource: "judge", resourceId: judge.id, metadata: { status: body.status } });
  return ok({ judge: updated });
});
