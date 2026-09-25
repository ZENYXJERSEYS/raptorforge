import { z } from "zod";
import { prisma } from "@/server/db";
import { requireAuth, requireEventOrganizer, isEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(5000).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  registrationStart: z.string().datetime().optional(),
  registrationEnd: z.string().datetime().optional(),
  submissionDeadline: z.string().datetime().optional(),
  status: z
    .enum(["DRAFT", "REGISTRATION_OPEN", "ACTIVE", "SUBMISSIONS_CLOSED", "JUDGING", "VOTING", "COMPLETED", "ARCHIVED"])
    .optional(),
  judgingMode: z.enum(["RUBRIC", "PAIRWISE"]).optional(),
  judgesPerProject: z.number().int().min(1).max(20).optional(),
  maxTeamSize: z.number().int().min(1).max(10).optional(),
  votingEnabled: z.boolean().optional(),
  votingStart: z.string().datetime().nullable().optional(),
  votingEnd: z.string().datetime().nullable().optional(),
  votesPerUser: z.number().int().min(1).max(100).optional(),
  votingResultsHidden: z.boolean().optional(),
  randomizedOrdering: z.boolean().optional(),
});

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: { tracks: true, prizes: true, _count: { select: { projects: true, teams: true } } },
  });
  if (!event) throw Errors.notFound("Event not found.");
  let organizerView = false;
  try {
    const { user } = await requireAuth(req);
    organizerView = await isEventOrganizer(user.id, event.id);
  } catch {
    /* public view */
  }
  const { _count, ...e } = event;
  return ok({ event: { ...e, projectCount: _count.projects, teamCount: _count.teams }, organizerView });
});

export const PATCH = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, updateSchema);
  const data: Record<string, unknown> = { ...body };
  for (const k of ["startDate", "endDate", "registrationStart", "registrationEnd", "submissionDeadline", "votingStart", "votingEnd"]) {
    if (data[k] !== undefined && data[k] !== null) data[k] = new Date(data[k] as string);
  }
  const event = await prisma.event.update({ where: { id }, data });
  await audit({ actorId: user.id, action: "EVENT_UPDATED", resource: "event", resourceId: id, metadata: { fields: Object.keys(body) } });
  return ok({ event });
});
