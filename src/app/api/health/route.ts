import { prisma } from "@/server/db";
import { handler, ok } from "@/server/api";

export const GET = handler(async () => {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "HEALTHY";
  } catch {
    checks.database = "UNREACHABLE";
    healthy = false;
  }
  checks.api = "HEALTHY";
  try {
    const pending = await prisma.webhookDelivery.count({ where: { status: "PENDING" } });
    checks.webhooks = pending > 100 ? "DEGRADED" : "HEALTHY";
  } catch {
    checks.webhooks = "UNREACHABLE";
    healthy = false;
  }
  checks.storage = "HEALTHY"; // local volumes only; nothing external to probe

  return ok(
    { status: healthy ? "HEALTHY" : "DEGRADED", checks, time: new Date().toISOString() },
    healthy ? 200 : 503
  );
});
