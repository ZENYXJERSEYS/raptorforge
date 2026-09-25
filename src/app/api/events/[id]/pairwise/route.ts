import { z } from "zod";
import { prisma } from "@/server/db";
import { requireJudge, requireEventOrganizer, requireAuth } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { estimateBradleyTerry, MIN_COMPARISONS_PER_PROJECT } from "@/server/judging/bradleyterry";

type Ctx = { params: Promise<{ id: string }> };

const recordSchema = z.object({
  projectA: z.string().min(1),
  projectB: z.string().min(1),
  winner: z.enum(["A", "B", "TIE"]),
});

async function loadEligibleProjects(eventId: string) {
  return prisma.project.findMany({
    where: { eventId, status: { in: ["SUBMITTED", "LOCKED"] } },
    select: { id: true, name: true, team: { select: { name: true } }, track: { select: { name: true } } },
  });
}

export const GET = handler(async (req, ctx) => {
  const { id: eventId } = await (ctx as Ctx).params;
  const { user } = await requireAuth(req);

  // judges get their next pair; organizers get standings
  if (await requireEventOrganizerSilent(req, eventId)) {
    const comps = await prisma.pairwiseComparison.findMany({ where: { eventId } });
    const projects = await loadEligibleProjects(eventId);
    const bt = estimateBradleyTerry(
      comps.map((c) => ({ projectA: c.projectA, projectB: c.projectB, winner: c.winner as "A" | "B" | "TIE" })),
      projects.map((p) => p.id)
    );
    return ok({
      standings: bt.rankings.map((r) => ({
        ...r,
        project: projects.find((p) => p.id === r.projectId)?.name ?? r.projectId,
        minComparisonsMet: r.comparisons >= MIN_COMPARISONS_PER_PROJECT,
      })),
      isolated: bt.isolated,
      nu: bt.nu,
      iterations: bt.iterations,
      totalComparisons: comps.length,
    });
  }

  // judge view: eligible projects and their own recorded comparisons
  const projects = await loadEligibleProjects(eventId);
  const mine = await prisma.pairwiseComparison.findMany({ where: { eventId, judgeId: user.id } });
  return ok({ projects, mine });
});

async function requireEventOrganizerSilent(req: Parameters<typeof requireAuth>[0], eventId: string): Promise<boolean> {
  try {
    const { user } = await requireAuth(req);
    if (user.role === "ADMIN") return true;
    const org = await prisma.eventOrganizer.findUnique({ where: { eventId_userId: { eventId, userId: user.id } } });
    return !!org;
  } catch {
    return false;
  }
}

export const POST = handler(async (req, ctx) => {
  const { id: eventId } = await (ctx as Ctx).params;
  const { user } = await requireJudge(req, eventId);
  const body = await parseBody(req, recordSchema);

  if (body.projectA === body.projectB) throw Errors.badRequest("Cannot compare a project with itself.");
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw Errors.notFound("Event not found.");
  if (event.judgingMode !== "PAIRWISE") throw Errors.badRequest("This event uses rubric judging mode.");

  const [pa, pb] = await Promise.all([
    prisma.project.findUnique({ where: { id: body.projectA } }),
    prisma.project.findUnique({ where: { id: body.projectB } }),
  ]);
  if (!pa || pa.eventId !== eventId || !pb || pb.eventId !== eventId) {
    throw Errors.notFound("Projects must belong to this event.");
  }

  const dupe = await prisma.pairwiseComparison.findFirst({
    where: {
      eventId, judgeId: user.id,
      OR: [
        { projectA: body.projectA, projectB: body.projectB },
        { projectA: body.projectB, projectB: body.projectA },
      ],
    },
  });
  if (dupe) throw Errors.conflict("You have already compared this pair.");

  const comp = await prisma.pairwiseComparison.create({
    data: { eventId, judgeId: user.id, projectA: body.projectA, projectB: body.projectB, winner: body.winner },
  });
  await audit(
    { actorId: user.id, action: "PAIRWISE_RECORDED", resource: "project", resourceId: body.projectA, metadata: { vs: body.projectB, winner: body.winner } },
    undefined
  );
  return ok({ comparison: comp }, 201);
});
