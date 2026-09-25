import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, ok } from "@/server/api";
import { enforceSubmissionDeadline } from "@/server/events/deadline";
import { queueWebhook } from "@/server/webhooks";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);
  const project = await prisma.project.findUnique({ where: { id }, include: { team: { include: { members: true } } } });
  if (!project) throw Errors.notFound("Submission not found.");
  if (!project.team.members.some((m) => m.userId === user.id)) {
    throw Errors.forbidden("You are not a member of this team.");
  }
  if (project.status === "SUBMITTED" || project.status === "LOCKED") {
    throw Errors.conflict("This submission has already been submitted.");
  }
  if (project.status === "DISQUALIFIED") {
    throw Errors.forbidden("This submission was disqualified; contact organizers.");
  }

  // Server-side deadline enforcement — client time is never consulted.
  const event = await prisma.event.findUnique({ where: { id: project.eventId } });
  if (!event) throw Errors.notFound("Event not found.");
  enforceSubmissionDeadline(event);

  const required: [string, unknown][] = [
    ["name", project.name],
    ["shortDescription", project.shortDescription],
    ["fullDescription", project.fullDescription],
    ["trackId", project.trackId],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw Errors.unprocessable(`Missing required fields: ${missing.join(", ")}`);

  const submitted = await prisma.$transaction(async (tx) => {
    const p = await tx.project.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
    await audit({ actorId: user.id, action: "PROJECT_SUBMITTED", resource: "project", resourceId: id, metadata: { name: p.name } }, tx);
    return p;
  });

  await queueWebhook({
    type: "submission.submitted",
    eventId: event.id,
    data: { projectId: id, name: submitted.name, teamId: submitted.teamId, submittedAt: submitted.submittedAt },
  });

  return ok({ project: submitted });
});
