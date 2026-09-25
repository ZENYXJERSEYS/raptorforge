import { prisma } from "@/server/db";
import type { Prisma, AuditAction } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Record an audit entry. Pass a `tx` to write atomically with the triggering
 * mutation; otherwise writes on the primary client.
 */
export async function audit(
  entry: {
    actorId?: string | null;
    action: AuditAction;
    resource: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
  tx?: Tx
): Promise<void> {
  const client = tx ?? prisma;
  await client.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
