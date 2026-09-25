import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { handler, ok } from "@/server/api";
import { dispatchPendingWebhooks } from "@/server/webhooks";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  await requireEventOrganizer(req, id);
  const result = await dispatchPendingWebhooks(50);
  return ok({ dispatched: result });
});
