import { z } from "zod";
import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { randomToken, isValidUrl } from "@/server/util";
import { WEBHOOK_EVENT_TYPES } from "@/server/webhooks";

type Ctx = { params: Promise<{ id: string }> };

const createSchema = z.object({
  url: z.string().max(500),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).default([]),
});

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  await requireEventOrganizer(req, id);
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { eventId: id },
    include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } },
    orderBy: { createdAt: "asc" },
  });
  return ok({
    endpoints: endpoints.map((e) => ({
      id: e.id,
      url: e.url,
      events: e.events,
      active: e.active,
      recentDeliveries: e.deliveries.map((d) => ({
        id: d.id, eventType: d.eventType, status: d.status, attempts: d.attempts, lastError: d.lastError, createdAt: d.createdAt,
      })),
    })),
  });
});

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, createSchema);
  if (!isValidUrl(body.url)) throw Errors.badRequest("url must be a valid http(s) URL.");

  const endpoint = await prisma.webhookEndpoint.create({
    data: { eventId: id, url: body.url, secret: `whsec_${randomToken(16)}`, events: body.events },
  });
  await audit({ actorId: user.id, action: "WEBHOOK_CREATED", resource: "webhook", resourceId: endpoint.id, metadata: { url: body.url } });
  return ok({ endpoint: { id: endpoint.id, url: endpoint.url, events: endpoint.events } }, 201);
});

export const DELETE = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const endpointId = req.nextUrl.searchParams.get("endpointId");
  if (!endpointId) throw Errors.badRequest("endpointId query parameter required.");
  const ep = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
  if (!ep || ep.eventId !== id) throw Errors.notFound("Endpoint not found.");
  await prisma.webhookEndpoint.delete({ where: { id: endpointId } });
  await audit({ actorId: user.id, action: "WEBHOOK_DELETED", resource: "webhook", resourceId: endpointId });
  return ok({ deleted: true });
});
