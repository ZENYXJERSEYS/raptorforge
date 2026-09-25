import { z } from "zod";
import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(""),
  amount: z.number().int().min(0).nullable().optional(),
  rank: z.number().int().min(1).default(1),
  trackId: z.string().nullable().optional(),
  kind: z.enum(["OVERALL", "TRACK", "CUSTOM"]).default("OVERALL"),
});

export const GET = handler(async (_req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const prizes = await prisma.prize.findMany({ where: { eventId: id }, orderBy: { rank: "asc" }, include: { track: { select: { name: true } } } });
  return ok({ prizes });
});

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, createSchema);
  if (body.trackId) {
    const track = await prisma.track.findUnique({ where: { id: body.trackId } });
    if (!track || track.eventId !== id) throw Errors.badRequest("trackId does not belong to this event.");
  }
  const prize = await prisma.prize.create({
    data: {
      eventId: id, name: body.name, description: body.description,
      amount: body.amount ?? null, rank: body.rank, trackId: body.trackId ?? null, kind: body.kind,
    },
  });
  await audit({ actorId: user.id, action: "EVENT_UPDATED", resource: "prize", resourceId: prize.id, metadata: { name: prize.name } });
  return ok({ prize }, 201);
});
