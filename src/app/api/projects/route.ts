import { z } from "zod";
import { prisma } from "@/server/db";
import { handler, ok } from "@/server/api";
import { Errors } from "@/server/errors";

const querySchema = z.object({
  eventId: z.string().min(1),
  q: z.string().max(120).optional(),
  track: z.string().max(80).optional(),
  tech: z.string().max(80).optional(),
  status: z.enum(["SUBMITTED", "LOCKED"]).optional(),
  sort: z.enum(["newest", "name", "team"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export const GET = handler(async (req) => {
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw Errors.badRequest("Invalid gallery query.");
  const { eventId, q, track, tech, sort, page, pageSize } = parsed.data;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw Errors.notFound("Event not found.");

  const where = {
    eventId,
    status: { in: ["SUBMITTED", "LOCKED"] as ("SUBMITTED" | "LOCKED")[] },
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { shortDescription: { contains: q, mode: "insensitive" as const } },
            { technologies: { has: q.toLowerCase() } },
          ],
        }
      : {}),
    ...(track ? { track: { slug: track } } : {}),
    ...(tech ? { technologies: { has: tech.toLowerCase() } } : {}),
  };

  const orderBy = sort === "newest" ? { submittedAt: "desc" as const } : sort === "name" ? { name: "asc" as const } : { team: { name: "asc" as const } };

  const [total, projects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, name: true, slug: true, shortDescription: true,
        technologies: true, status: true, submittedAt: true,
        track: { select: { name: true, slug: true } },
        team: { select: { name: true } },
        _count: { select: { comments: { where: { isHidden: false } } } },
      },
    }),
  ]);

  // NOTE: vote totals are deliberately omitted while results are hidden (T3).
  return ok({
    projects: projects.map((p) => ({
      ...p,
      commentCount: p._count.comments,
      _count: undefined,
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});
