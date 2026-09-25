import { z } from "zod";
import { prisma } from "@/server/db";
import { requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";

const createSchema = z
  .object({
    name: z.string().min(2).max(120),
    slug: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, dashes").max(80),
    description: z.string().max(5000).default(""),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    registrationStart: z.string().datetime(),
    registrationEnd: z.string().datetime(),
    submissionDeadline: z.string().datetime(),
  })
  .refine((v) => new Date(v.startDate) < new Date(v.endDate), { message: "startDate must precede endDate" })
  .refine((v) => new Date(v.registrationStart) < new Date(v.registrationEnd), { message: "registrationStart must precede registrationEnd" });

export const GET = handler(async () => {
  const events = await prisma.event.findMany({
    where: { status: { notIn: ["ARCHIVED", "DRAFT"] } },
    orderBy: { startDate: "desc" },
    select: {
      id: true, name: true, slug: true, description: true, status: true,
      startDate: true, endDate: true, registrationEnd: true,
      submissionDeadline: true, votingEnabled: true,
      _count: { select: { projects: true, teams: true } },
    },
  });
  return ok({ events: events.map(({ _count, ...e }) => ({ ...e, projectCount: _count.projects, teamCount: _count.teams })) });
});

export const POST = handler(async (req) => {
  const { user } = await requireAuth(req);
  if (user.role !== "ORGANIZER" && user.role !== "ADMIN") {
    throw Errors.forbidden("Only organizers can create events.");
  }
  const body = await parseBody(req, createSchema);
  const slugTaken = await prisma.event.findUnique({ where: { slug: body.slug } });
  if (slugTaken) throw Errors.conflict("An event with this slug already exists.");

  const event = await prisma.event.create({
    data: {
      name: body.name,
      slug: body.slug,
      description: body.description,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      registrationStart: new Date(body.registrationStart),
      registrationEnd: new Date(body.registrationEnd),
      submissionDeadline: new Date(body.submissionDeadline),
    },
  });
  await prisma.eventOrganizer.create({
    data: { eventId: event.id, userId: user.id, assignedBy: "system" },
  });
  await audit({ actorId: user.id, action: "EVENT_CREATED", resource: "event", resourceId: event.id, metadata: { slug: event.slug } });
  return ok({ event }, 201);
});
