import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { handler, ok } from "@/server/api";
import { verificationHash } from "@/server/certificates/pdf";

type Ctx = { params: Promise<{ certificateId: string }> };

export const GET = handler(async (_req, ctx) => {
  const { certificateId } = await (ctx as Ctx).params;
  const cert = await prisma.certificate.findUnique({
    where: { certificateId },
    include: { user: { select: { id: true, name: true } }, event: { select: { name: true, slug: true } } },
  });
  if (!cert) throw Errors.notFound("No certificate exists with this ID.");

  const expected = verificationHash({
    certificateId: cert.certificateId,
    userId: cert.userId,
    eventId: cert.eventId,
    achievement: cert.achievement,
    issuedAt: cert.issuedAt,
  });
  const valid = expected === cert.verificationHash;

  // Privacy: show given name only — enough to verify, not enough to dox.
  const givenName = cert.user.name.split(" ")[0];

  return ok({
    verified: valid,
    certificate: {
      certificateId: cert.certificateId,
      participant: givenName,
      event: cert.event.name,
      achievement: cert.achievement,
      issuedAt: cert.issuedAt,
    },
  });
});
