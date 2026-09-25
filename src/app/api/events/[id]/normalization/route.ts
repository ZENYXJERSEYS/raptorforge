import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { handler, ok } from "@/server/api";
import { normalizeScores, MIN_SCORES_FOR_NORMALIZATION, WINSOR_LIMIT, MAP_MEAN, MAP_SPAN } from "@/server/judging/normalization";
import { round2 } from "@/server/util";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  await requireEventOrganizer(req, id);

  const judgements = await prisma.judgement.findMany({
    where: { project: { eventId: id } },
    select: { judgeId: true, projectId: true, weightedScore: true },
  });
  const raw = (judgements.filter((j) => j.weightedScore != null) as { judgeId: string; projectId: string; weightedScore: number }[]).map(
    (j) => ({ judgeId: j.judgeId, projectId: j.projectId, score: j.weightedScore })
  );

  const judges = await prisma.judge.findMany({ where: { eventId: id }, include: { user: { select: { name: true } } } });
  const projects = await prisma.project.findMany({ where: { eventId: id, status: { not: "DRAFT" } }, select: { id: true, name: true } });
  const judgeName = new Map(judges.map((j) => [j.id, j.user.name]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const norm = normalizeScores(raw);

  // raw ranking vs normalized ranking + shifts
  const rawMean = new Map<string, number>();
  const normMean = new Map<string, number>();
  for (const s of norm.scores) {
    rawMean.set(s.projectId, (rawMean.get(s.projectId) ?? 0) + s.score);
  }
  for (const [pid, sum] of rawMean) rawMean.set(pid, round2(sum / (norm.scores.filter((s) => s.projectId === pid).length || 1)));
  for (const p of norm.projectSummary) {
    if (p.normalizedMean != null) normMean.set(p.projectId, p.normalizedMean);
  }

  const rankOf = (m: Map<string, number>) => {
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const out = new Map<string, number>();
    sorted.forEach(([pid], i) => out.set(pid, i + 1));
    return out;
  };
  const rawRank = rankOf(rawMean);
  const normRank = rankOf(normMean);

  const shifts = projects
    .map((p) => ({
      project: p.name,
      rawRank: rawRank.get(p.id) ?? null,
      normalizedRank: normRank.get(p.id) ?? null,
      changed: rawRank.has(p.id) && normRank.has(p.id) && rawRank.get(p.id) !== normRank.get(p.id),
    }))
    .filter((s) => s.rawRank != null);

  return ok({
    methodology: {
      method: "z-score normalization with winsorization",
      formula: "z = (score - judgeMean) / judgeSigma → normalized = 50 + 10·z (clamped ±2.5)",
      minScores: MIN_SCORES_FOR_NORMALIZATION,
      winsorLimit: WINSOR_LIMIT,
      map: `${MAP_MEAN} + ${MAP_SPAN}·z`,
      edgeCases: [
        "Judges with fewer than 5 completed judgements are left raw (insufficient-data).",
        "Judges with zero variance map to the scale mean (50).",
        "z is winsorized to ±2.5 so one extreme score cannot dominate.",
        "Missing scores are never interpolated — only completed judgements count.",
      ],
      limitations:
        "z-scores assume roughly normal judge behavior and equal project exposure across judges. With sparse overlap the estimates are noisy — see JUDGING.md §Limitations.",
    },
    judgeStats: norm.stats.map((s) => ({ ...s, judgeName: judgeName.get(s.judgeId) ?? s.judgeId })),
    scores: norm.scores.map((s) => ({ ...s, judgeName: judgeName.get(s.judgeId) ?? s.judgeId, projectName: projectName.get(s.projectId) ?? s.projectId })),
    rankShifts: {
      count: shifts.filter((s) => s.changed).length,
      rows: shifts.sort((a, b) => (a.rawRank ?? 999) - (b.rawRank ?? 999)),
    },
  });
});
