import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { handler } from "@/server/api";
import { generateCertificatePdf } from "@/server/certificates/pdf";

type Ctx = { params: Promise<{ certificateId: string }> };

export const GET = handler(async (_req, ctx) => {
  const { certificateId } = await (ctx as Ctx).params;
  const cert = await prisma.certificate.findUnique({
    where: { certificateId },
    include: { user: { select: { name: true } }, event: { select: { name: true } } },
  });
  if (!cert) throw Errors.notFound("No certificate exists with this ID.");

  const pdf = await generateCertificatePdf({
    participantName: cert.user.name,
    eventName: cert.event.name,
    achievement: cert.achievement,
    issuedAt: cert.issuedAt,
    certificateId: cert.certificateId,
    verificationHash: cert.verificationHash,
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="raptorforge-certificate-${cert.certificateId}.pdf"`,
    },
  });
});
