import { prisma } from "@/server/db";
import { requireRole } from "@/server/auth/rbac";
import { handler, ok } from "@/server/api";
import { z } from "zod";

const querySchema = z.object({
  action: z.string().max(60).optional(),
  resource: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = handler(async (req) => {
  await requireRole(req, ["ORGANIZER", "ADMIN"]);
  const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

  const where = {
    ...(q.action ? { action: q.action as never } : {}),
    ...(q.resource ? { resource: q.resource } : {}),
  };
  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  const actorIds = [...new Set(entries.map((e) => e.actorId).filter((x): x is string => !!x))];
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true, email: true },
  });
  const actorById = new Map(actors.map((u) => [u.id, u]));

  return ok({
    entries: entries.map((e) => ({
      id: e.id,
      action: e.action,
      resource: e.resource,
      resourceId: e.resourceId,
      metadata: e.metadata,
      createdAt: e.createdAt,
      actor: e.actorId ? actorById.get(e.actorId) ?? { id: e.actorId, name: "unknown", email: "" } : null,
    })),
    pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
  });
});
