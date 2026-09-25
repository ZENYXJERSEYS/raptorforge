import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Load .env explicitly — with prisma.config.ts present, the CLI no longer
  // auto-loads it (documented Prisma 6 behavior).
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
