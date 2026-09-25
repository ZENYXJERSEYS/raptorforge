import { z } from "zod";
import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { certificateId, verificationHash } from "@/server/certificates/pdf";
import { queueWebhook } from "@/server/webhooks";

type Ctx = { params: Promise<{ id: string }> };

const issueSchema = z.object({
  userId: z.string().min(1),
  achievement: z.string().min(1).max(80).default("PARTICIPANT"),
});

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  await requireEventOrganizer(req, id);
  const certs = await prisma.certificate.findMany({
    where: { eventId: id },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { issuedAt: "desc" },
  });
  return ok({
    certificates: certs.map((c) => ({
      certificateId: c.certificateId,
      participant: c.user.name,
      achievement: c.achievement,
      issuedAt: c.issuedAt,
    })),
  });
});

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, issueSchema);

  const target = await prisma.user.findUnique({ where: { id: body.userId } });
  if (!target) throw Errors.notFound("User not found.");
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) throw Errors.notFound("Event not found.");

  const dupe = await prisma.certificate.findUnique({
    where: { eventId_userId_achievement: { eventId: id, userId: body.userId, achievement: body.achievement } },
  });
  if (dupe) throw Errors.conflict("This certificate already exists.");

  const cid = certificateId(`${id}:${body.userId}:${body.achievement}`);
  const issuedAt = new Date();
  const cert = await prisma.certificate.create({
    data: {
      certificateId: cid,
      eventId: id,
      userId: body.userId,
      achievement: body.achievement,
      issuedAt,
      verificationHash: verificationHash({
        certificateId: cid,
        userId: body.userId,
        eventId: id,
        achievement: body.achievement,
        issuedAt,
      }),
    },
  });

  await audit(
    { actorId: user.id, action: "CERTIFICATE_GENERATED", resource: "certificate", resourceId: cert.id, metadata: { certificateId: cid, userId: body.userId } },
    undefined
  );
  await queueWebhook({ type: "certificate.generated", eventId: id, data: { certificateId: cid, userId: body.userId } });
  return ok({ certificate: { certificateId: cert.certificateId, achievement: cert.achievement, issuedAt: cert.issuedAt } }, 201);
});
