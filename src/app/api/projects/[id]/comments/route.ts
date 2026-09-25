import { z } from "zod";
import { prisma } from "@/server/db";
import { requireAuth, isEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { enforceRateLimit } from "@/server/ratelimit";
import { handler, parseBody, ok } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

const createSchema = z.object({ body: z.string().min(1).max(2000) });

export const GET = handler(async (_req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const comments = await prisma.comment.findMany({
    where: { projectId: id, isHidden: false },
    include: { author: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok({ comments: comments.map((c) => ({ id: c.id, body: c.body, author: c.author.name, createdAt: c.createdAt })) });
});

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);
  const body = await parseBody(req, createSchema);

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.status === "DRAFT" || project.status === "DISQUALIFIED") {
    throw Errors.notFound("Project not found.");
  }

  // spam control: max 5 comments per user per minute
  await enforceRateLimit(`comment:${user.id}`, 5, 60_000);

  const comment = await prisma.comment.create({
    data: { eventId: project.eventId, projectId: id, authorId: user.id, body: body.body },
  });
  await audit({ actorId: user.id, action: "COMMENT_CREATED", resource: "project", resourceId: id, metadata: { commentId: comment.id } });
  return ok({ comment }, 201);
});

export const DELETE = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);
  const commentId = req.nextUrl.searchParams.get("commentId");
  if (!commentId) throw Errors.badRequest("commentId query parameter required.");
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment || comment.projectId !== id) throw Errors.notFound("Comment not found.");

  const organizer = await isEventOrganizer(user.id, comment.eventId);
  if (comment.authorId !== user.id && !organizer) {
    throw Errors.forbidden("You can only delete your own comments.");
  }
  const moderated = organizer && comment.authorId !== user.id;
  await prisma.comment.update({ where: { id: commentId }, data: { isHidden: true } });
  await audit({
    actorId: user.id,
    action: moderated ? "COMMENT_MODERATED" : "COMMENT_DELETED",
    resource: "comment",
    resourceId: commentId,
    metadata: { projectId: id },
  });
  return ok({ deleted: true, moderated });
});
