import { z } from "zod";
import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { isValidUrl } from "@/server/util";

type Ctx = { params: Promise<{ id: string }> };

const editSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  trackId: z.string().nullable().optional(),
  shortDescription: z.string().max(280).optional(),
  fullDescription: z.string().max(20000).optional(),
  repositoryUrl: z.string().max(500).nullable().optional(),
  demoUrl: z.string().max(500).nullable().optional(),
  videoUrl: z.string().max(500).nullable().optional(),
  technologies: z.array(z.string().max(40)).max(20).optional(),
});

async function loadProjectWithMembership(id: string, userId: string) {
  const project = await prisma.project.findUnique({ where: { id }, include: { team: { include: { members: true } } } });
  if (!project) throw Errors.notFound("Submission not found.");
  if (!project.team.members.some((m) => m.userId === userId)) {
    throw Errors.forbidden("You are not a member of this team.");
  }
  return project;
}

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);
  const project = await loadProjectWithMembership(id, user.id);
  return ok({ project });
});

export const PATCH = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);
  const project = await loadProjectWithMembership(id, user.id);

  if (project.status !== "DRAFT") {
    throw Errors.forbidden(
      project.status === "LOCKED"
        ? "This submission is locked and can no longer be edited."
        : "Submitted projects cannot be edited unless unlocked by an organizer."
    );
  }

  const body = await parseBody(req, editSchema);
  for (const [label, url] of [["repositoryUrl", body.repositoryUrl], ["demoUrl", body.demoUrl], ["videoUrl", body.videoUrl]] as const) {
    if (url && !isValidUrl(url)) throw Errors.badRequest(`${label} must be a valid http(s) URL.`);
  }
  if (body.trackId) {
    const track = await prisma.track.findUnique({ where: { id: body.trackId } });
    if (!track || track.eventId !== project.eventId) throw Errors.badRequest("trackId does not belong to this event.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.project.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.trackId !== undefined ? { trackId: body.trackId } : {}),
        ...(body.shortDescription !== undefined ? { shortDescription: body.shortDescription } : {}),
        ...(body.fullDescription !== undefined ? { fullDescription: body.fullDescription } : {}),
        ...(body.repositoryUrl !== undefined ? { repositoryUrl: body.repositoryUrl } : {}),
        ...(body.demoUrl !== undefined ? { demoUrl: body.demoUrl } : {}),
        ...(body.videoUrl !== undefined ? { videoUrl: body.videoUrl } : {}),
        ...(body.technologies !== undefined ? { technologies: body.technologies } : {}),
      },
    });
    await audit({ actorId: user.id, action: "PROJECT_UPDATED", resource: "project", resourceId: id, metadata: { fields: Object.keys(body) } }, tx);
    return p;
  });
  return ok({ project: updated });
});
