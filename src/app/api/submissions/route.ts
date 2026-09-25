import { z } from "zod";
import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { isValidUrl, slugify } from "@/server/util";

const createSchema = z.object({
  eventId: z.string().min(1),
  teamId: z.string().min(1),
  name: z.string().min(2).max(120),
  trackId: z.string().nullable().optional(),
  shortDescription: z.string().max(280).default(""),
  fullDescription: z.string().max(20000).default(""),
  repositoryUrl: z.string().max(500).nullable().optional(),
  demoUrl: z.string().max(500).nullable().optional(),
  videoUrl: z.string().max(500).nullable().optional(),
  technologies: z.array(z.string().max(40)).max(20).default([]),
});

export const GET = handler(async (req) => {
  const { user } = await requireAuth(req);
  const eventId = req.nextUrl.searchParams.get("eventId") ?? undefined;
  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id, ...(eventId ? { team: { eventId } } : {}) },
    select: { teamId: true },
  });
  const teamIds = memberships.map((m) => m.teamId);
  const submissions = await prisma.project.findMany({
    where: { teamId: { in: teamIds } },
    include: { track: { select: { name: true } }, team: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return ok({ submissions });
});

export const POST = handler(async (req) => {
  const { user } = await requireAuth(req);
  const body = await parseBody(req, createSchema);

  for (const [label, url] of [["repositoryUrl", body.repositoryUrl], ["demoUrl", body.demoUrl], ["videoUrl", body.videoUrl]] as const) {
    if (url && !isValidUrl(url)) throw Errors.badRequest(`${label} must be a valid http(s) URL.`);
  }

  const team = await prisma.team.findUnique({ where: { id: body.teamId }, include: { members: true } });
  if (!team || team.eventId !== body.eventId) throw Errors.notFound("Team not found for this event.");
  if (!team.members.some((m) => m.userId === user.id)) {
    throw Errors.forbidden("You must be a member of the team to create its submission.");
  }

  const event = await prisma.event.findUnique({ where: { id: body.eventId } });
  if (!event) throw Errors.notFound("Event not found.");

  const existing = await prisma.project.findUnique({ where: { eventId_teamId: { eventId: body.eventId, teamId: body.teamId } } });
  if (existing) throw Errors.conflict("This team already has a submission.");

  if (body.trackId) {
    const track = await prisma.track.findUnique({ where: { id: body.trackId } });
    if (!track || track.eventId !== body.eventId) throw Errors.badRequest("trackId does not belong to this event.");
  }

  const baseSlug = slugify(body.name);
  let slug = baseSlug;
  let n = 2;
  while (await prisma.project.findUnique({ where: { eventId_slug: { eventId: body.eventId, slug } } })) {
    slug = `${baseSlug}-${n++}`;
  }

  const project = await prisma.project.create({
    data: {
      eventId: body.eventId,
      teamId: body.teamId,
      trackId: body.trackId ?? null,
      name: body.name,
      slug,
      shortDescription: body.shortDescription,
      fullDescription: body.fullDescription,
      repositoryUrl: body.repositoryUrl ?? null,
      demoUrl: body.demoUrl ?? null,
      videoUrl: body.videoUrl ?? null,
      technologies: body.technologies,
      status: "DRAFT",
      createdById: user.id,
    },
  });
  await audit({ actorId: user.id, action: "PROJECT_CREATED", resource: "project", resourceId: project.id, metadata: { name: project.name } });
  return ok({ project }, 201);
});
