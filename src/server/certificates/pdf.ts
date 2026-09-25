import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "node:crypto";

export interface CertificateData {
  participantName: string;
  eventName: string;
  achievement: string;
  issuedAt: Date;
  certificateId: string;
  verificationHash: string;
}

/** Stable verification hash tied to certificate content + APP_SECRET. */
export function verificationHash(parts: {
  certificateId: string;
  userId: string;
  eventId: string;
  achievement: string;
  issuedAt: Date;
}): string {
  const secret = process.env.APP_SECRET ?? "dev";
  return createHash("sha256")
    .update(
      [
        secret,
        parts.certificateId,
        parts.userId,
        parts.eventId,
        parts.achievement,
        parts.issuedAt.toISOString(),
      ].join("|")
    )
    .digest("hex")
    .slice(0, 32);
}

/** Human-facing certificate id, e.g. DF26-7A82F1 (deterministic per input). */
export function certificateId(seed: string): string {
  const h = createHash("sha256").update(`${process.env.APP_SECRET ?? "dev"}:${seed}`).digest("hex");
  const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
  return `RF${yy}-${h.slice(0, 6).toUpperCase()}`;
}

/** Generate the certificate PDF locally with pdf-lib — no external services. */
export async function generateCertificatePdf(data: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]); // A4 landscape
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const { width, height } = page.getSize();
  const border = rgb(0.16, 0.22, 0.32);
  const ink = rgb(0.1, 0.12, 0.16);
  const accent = rgb(0.95, 0.45, 0.1);

  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: border, borderWidth: 2 });
  page.drawRectangle({ x: 24, y: height - 48, width: width - 48, height: 8, color: accent });

  const cx = width / 2;
  page.drawText("RAPTORFORGE CERTIFICATE", { x: cx - 150, y: height - 110, size: 22, font: bold, color: ink });
  page.drawText("This certifies that", { x: cx - 55, y: height - 160, size: 12, font: regular, color: ink });

  const nameSize = 30;
  page.drawText(data.participantName, {
    x: cx - (data.participantName.length * nameSize) / 4.4,
    y: height - 205,
    size: nameSize,
    font: bold,
    color: ink,
  });

  page.drawText(`for participation in`, { x: cx - 50, y: height - 245, size: 12, font: regular, color: ink });
  page.drawText(data.eventName, { x: cx - (data.eventName.length * 16) / 2.6, y: height - 280, size: 18, font: bold, color: ink });
  page.drawText(`Achievement: ${data.achievement}`, { x: cx - 110, y: height - 315, size: 12, font: regular, color: ink });
  page.drawText(`Issued: ${data.issuedAt.toISOString().slice(0, 10)}`, { x: cx - 60, y: height - 340, size: 11, font: regular, color: ink });

  page.drawText(`Certificate ID: ${data.certificateId}`, { x: 64, y: 80, size: 12, font: bold, color: ink });
  page.drawText(`Verify: ${`/verify/${data.certificateId}`}`, { x: 64, y: 62, size: 10, font: regular, color: ink });
  page.drawText(`Hash: ${data.verificationHash}`, { x: 64, y: 46, size: 9, font: mono, color: border });

  return doc.save();
}
