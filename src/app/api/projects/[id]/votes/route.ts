import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { handler, ok } from "@/server/api";
import { castVote } from "@/server/voting";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req, ctx) => {
  const { id: projectId } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const ua = req.headers.get("user-agent");
  const vote = await castVote({
    userId: user.id,
    eventId: (await prisma.project.findUnique({ where: { id: projectId }, select: { eventId: true } }))?.eventId ?? "",
    projectId,
    ip,
    userAgent: ua,
  });
  return ok({ vote: { id: vote.id, flagLevel: vote.flagLevel } }, 201);
});
