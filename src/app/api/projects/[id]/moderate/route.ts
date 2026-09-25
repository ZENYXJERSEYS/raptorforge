import { z } from "zod";
import { prisma } from "@/server/db";
import { requireAuth, isEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ action: z.enum(["LOCK", "UNLOCK", "DISQUALIFY"]) });

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw Errors.notFound("Submission not found.");
  if (!(await isEventOrganizer(user.id, project.eventId))) {
    throw Errors.forbidden("Organizer access required.");
  }
  const body = await parseBody(req, schema);

  const status =
    body.action === "LOCK" ? "LOCKED" : body.action === "UNLOCK" ? "SUBMITTED" : "DISQUALIFIED";
  const updated = await prisma.project.update({ where: { id }, data: { status } });
  const action =
    body.action === "LOCK" ? "PROJECT_LOCKED" : body.action === "UNLOCK" ? "PROJECT_UPDATED" : "PROJECT_DISQUALIFIED";
  await audit({ actorId: user.id, action, resource: "project", resourceId: id, metadata: { status } });
  return ok({ project: updated });
});
