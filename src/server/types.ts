import type { Prisma } from "@prisma/client";

export type Tx = Prisma.TransactionClient;
export type PrismaClientOrTx = Tx | import("@prisma/client").PrismaClient;
