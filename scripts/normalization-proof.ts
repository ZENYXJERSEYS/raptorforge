/**
 * Normalization proof fixture generator (bonus).
 * Regenerates fixtures/normalization/{before.csv,after.csv,report.md} from the
 * seeded Dogfood 2026 event using the REAL normalization engine.
 * Run: npm run db:up && npm run db:seed && npx tsx scripts/normalization-proof.ts
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";
import { normalizeScores } from "../src/server/judging/normalization";
import { round2, toCsv } from "../src/server/util";

const prisma = new PrismaClient();

async function main() {
  const event = await prisma.event.findUnique({ where: { slug: "dogfood-2026" } });
  if (!event) throw new Error("seed first: npm run db:seed");

  const judgements = await prisma.judgement.findMany({
    where: { project: { eventId: event.id }, weightedScore: { not: null } },
    select: { judgeId: true, projectId: true, weightedScore: true },
  });
  const raw = judgements.map((j) => ({ judgeId: j.judgeId, projectId: j.projectId, score: j.weightedScore! }));

  const judges = await prisma.judge.findMany({ where: { eventId: event.id }, include: { user: true } });
  const projects = await prisma.project.findMany({ where: { eventId: event.id, status: { not: "DRAFT" } } });
  const judgeName = new Map(judges.map((j) => [j.id, j.user.name]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const norm = normalizeScores(raw);
  mkdirSync("fixtures/normalization", { recursive: true });

  // BEFORE: raw scores per (project, judge)
  writeFileSync(
    "fixtures/normalization/before.csv",
    toCsv(
      ["project", "judge", "rawScore"],
      raw.map((r) => [projectName.get(r.projectId) ?? r.projectId, judgeName.get(r.judgeId) ?? r.judgeId, r.score])
    )
  );

  // AFTER: normalized scores per (project, judge)
  writeFileSync(
    "fixtures/normalization/after.csv",
    toCsv(
      ["project", "judge", "rawScore", "z", "normalized", "note"],
      norm.scores.map((s) => [
        projectName.get(s.projectId) ?? s.projectId,
        judgeName.get(s.judgeId) ?? s.judgeId,
        s.score,
        s.z ?? "",
        s.normalized ?? "",
        s.note ?? "",
      ])
    )
  );

  // rankings raw vs normalized
  const rawMean = new Map<string, number>();
  for (const r of raw) rawMean.set(r.projectId, (rawMean.get(r.projectId) ?? 0) + r.score);
  for (const [pid, sum] of rawMean) rawMean.set(pid, round2(sum / (raw.filter((r) => r.projectId === pid).length || 1)));
  const normMean = new Map<string, number>();
  for (const p of norm.projectSummary) if (p.normalizedMean != null) normMean.set(p.projectId, p.normalizedMean);

  const rank = (m: Map<string, number>) =>
    new Map([...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([pid], i) => [pid, i + 1]));
  const rawRank = rank(rawMean);
  const normRank = rank(normMean);

  const rows = [...rawMean.keys()].map((pid) => ({
    name: projectName.get(pid) ?? pid,
    raw: rawMean.get(pid)!,
    norm: normMean.get(pid) ?? null,
    rr: rawRank.get(pid)!,
    nr: normRank.get(pid) ?? null,
  }));
  const changed = rows.filter((r) => r.rr !== r.nr).length;

  const judgeLines = norm.stats
    .map(
      (s) =>
        `| ${judgeName.get(s.judgeId) ?? s.judgeId} | ${s.n} | ${s.mean} | ${s.sigma} | ${s.status} |`
    )
    .join("\n");

  writeFileSync(
    "fixtures/normalization/report.md",
    `# Normalization Proof — Dogfood 2026

Generated ${new Date().toISOString()} by \`scripts/normalization-proof.ts\` using the production
normalization engine (\`src/server/judging/normalization.ts\`) over the seeded fixture data.

## Why normalization applies

The seed deliberately encodes divergent judge calibration: one lenient judge averages ~91
while a harsh judge averages ~68. Averaging raw scores treats that gap as project quality,
which it is not. Per-judge z-scores re-center each judge before projects are compared.

## Judge distributions (raw weighted scores)

| Judge | n | mean | σ | status |
|---|---|---|---|---|
${judgeLines}

- **normalized** — z-scores computed, winsorized at ±2.5, mapped to 50 + 10z.
- **insufficient-data** — fewer than 5 completed judgements; scores left raw and excluded
  from normalized rankings (no interpolation is performed).
- **zero-variance** — judge gave identical scores; z = 0 by definition.

## Ranking changes

${changed} of ${rows.length} ranked projects changed position after normalization.

| Project | Raw mean | Normalized | Raw rank | Normalized rank |
|---|---|---|---|---|
${rows
  .sort((a, b) => a.rr - b.rr)
  .map((r) => `| ${r.name} | ${r.raw} | ${r.norm ?? "—"} | ${r.rr} | ${r.nr ?? "—"} |`)
  .join("\n")}

Files: \`before.csv\` (raw), \`after.csv\` (normalized, with z and notes).

## Limitations of the method

1. **Sparse overlap** — z-scores are only comparable when judges share projects; with
   few common assignments the estimates are noisy.
2. **Normality assumption** — z-scores assume roughly symmetric judge behavior; heavily
   skewed scoring still distorts rankings.
3. **Winsorization trade-off** — capping at ±2.5σ limits outlier influence but also
   compresses genuine signal from exceptional projects.
4. **Equal-weight mapping** — 50 + 10z is a display convention, not a calibrated
   probability; only relative order is meaningful.
5. **No confidence intervals** — judges with few scores get point estimates without
   uncertainty; the lab UI surfaces per-judge n for this reason.
`
  );
  console.log(`fixtures/normalization written (${changed} rank changes demonstrated)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
