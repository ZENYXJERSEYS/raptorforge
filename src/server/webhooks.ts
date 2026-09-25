import { createHmac } from "node:crypto";
import { prisma } from "@/server/db";
import type { Prisma } from "@prisma/client";

/**
 * Local webhook delivery (offline-friendly): deliveries are persisted FIRST,
 * then dispatched with fetch + HMAC-SHA256 signature. Delivery is never
 * required for core functionality — failures are logged and retryable.
 */

export interface WebhookEvent {
  type: string;
  eventId: string;
  data: Record<string, unknown>;
}

export function signPayload(secret: string, body: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export const WEBHOOK_EVENT_TYPES = [
  "submission.created",
  "submission.submitted",
  "judgement.completed",
  "results.published",
  "certificate.generated",
] as const;

/** Queue a delivery for every active endpoint subscribed to this event type. */
export async function queueWebhook(evt: WebhookEvent): Promise<number> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { eventId: evt.eventId, active: true, OR: [{ events: { has: evt.type } }, { events: { isEmpty: true } }] },
  });
  if (endpoints.length === 0) return 0;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: evt.type, eventId: evt.eventId, data: evt.data, timestamp });
  const payload = { type: evt.type, eventId: evt.eventId, data: evt.data, timestamp } as unknown as Prisma.InputJsonValue;
  await prisma.webhookDelivery.createMany({
    data: endpoints.map((ep) => ({
      endpointId: ep.id,
      eventType: evt.type,
      payloadJson: payload,
      signature: signPayload(ep.secret, body, timestamp),
      status: "PENDING",
    })),
  });
  return endpoints.length;
}

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [0, 5000, 30000, 120000, 600000];

/** Dispatch pending deliveries (called by the cron-ish dispatcher or on demand). */
export async function dispatchPendingWebhooks(limit = 20): Promise<{ delivered: number; failed: number }> {
  const pending = await prisma.webhookDelivery.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let delivered = 0;
  let failed = 0;
  for (const d of pending) {
    const ep = await prisma.webhookEndpoint.findUnique({ where: { id: d.endpointId } });
    if (!ep || !ep.active) {
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "FAILED", lastError: "endpoint inactive" } });
      failed++;
      continue;
    }
    const body = JSON.stringify(d.payloadJson);
    try {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RaptorForge-Signature": `sha256=${d.signature}`,
          "X-RaptorForge-Event": d.eventType,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        await prisma.webhookDelivery.update({
          where: { id: d.id },
          data: { status: "DELIVERED", attempts: { increment: 1 }, deliveredAt: new Date(), lastError: null },
        });
        delivered++;
      } else {
        await prisma.webhookDelivery.update({
          where: { id: d.id },
          data: { status: "FAILED", attempts: { increment: 1 }, lastError: `HTTP ${res.status}` },
        });
        failed++;
      }
    } catch (err) {
      // Offline / unreachable receiver: recorded, retryable, core flow unaffected.
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          lastError: err instanceof Error ? err.message.slice(0, 300) : "delivery error",
        },
      });
      failed++;
    }
  }
  return { delivered, failed };
}

export { RETRY_DELAYS_MS, MAX_ATTEMPTS };
