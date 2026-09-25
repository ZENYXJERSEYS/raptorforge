import { z } from "zod";
import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { slugify } from "@/server/util";

type Ctx = { params: Promise<{ id: string }> };

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(1000).default(""),
  capacity: z.number().int().min(1).max(10000).nullable().optional(),
});

export const GET = handler(async (_req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const tracks = await prisma.track.findMany({ where: { eventId: id }, orderBy: { name: "asc" } });
  return ok({ tracks });
});

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, createSchema);
  const slug = slugify(body.name);
  const dupe = await prisma.track.findUnique({ where: { eventId_slug: { eventId: id, slug } } });
  if (dupe) throw Errors.conflict("A track with this name already exists on the event.");
  const track = await prisma.track.create({
    data: { eventId: id, name: body.name, slug, description: body.description, capacity: body.capacity ?? null },
  });
  await audit({ actorId: user.id, action: "EVENT_UPDATED", resource: "track", resourceId: track.id, metadata: { slug } });
  return ok({ track }, 201);
});
