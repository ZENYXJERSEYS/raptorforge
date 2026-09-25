import { z } from "zod";
import { prisma } from "@/server/db";
import { requireEventOrganizer, requireAuth, sessionUserOrNull } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { generateResults, latestResults } from "@/server/results";
import { votingOpen } from "@/server/voting";
import { queueWebhook } from "@/server/webhooks";

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.object({ action: z.enum(["generate", "publish", "unpublish"]) });

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, actionSchema);

  if (body.action === "generate") {
    const payload = await generateResults(id);
    await audit({ actorId: user.id, action: "RESULTS_GENERATED", resource: "event", resourceId: id, metadata: { mode: payload.mode } });
    return ok({ results: payload }, 201);
  }

  const res = await latestResults(id);
  if (!res) throw Errors.notFound("No results generated yet.");
  const updated = await prisma.eventResult.update({ where: { id: res.id }, data: { published: body.action === "publish" } });
  if (body.action === "publish") {
    await queueWebhook({ type: "results.published", eventId: id, data: { resultId: res.id } });
  }
  return ok({ published: updated.published });
});

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) throw Errors.notFound("Event not found.");

  let organizer = false;
  const user = await sessionUserOrNull(req.cookies.get("rf_session")?.value);
  if (user) {
    if (user.role === "ADMIN") organizer = true;
    else organizer = !!(await prisma.eventOrganizer.findUnique({ where: { eventId_userId: { eventId: id, userId: user.id } } }));
  }

  // While voting is active and results hidden, public callers get nothing here.
  const votingActive = votingOpen(event);
  if (!organizer && event.votingResultsHidden && votingActive) {
    throw Errors.forbidden("Results are hidden until voting closes.");
  }

  const res = await latestResults(id);
  if (!res) throw Errors.notFound("Results have not been generated yet.");
  if (!organizer && !res.published && event.votingResultsHidden) {
    throw Errors.forbidden("Results have not been published yet.");
  }
  return ok({ results: res.payloadJson, published: res.published, generatedAt: res.createdAt });
});
