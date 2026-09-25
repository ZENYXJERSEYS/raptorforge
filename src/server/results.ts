import { prisma } from "@/server/db";
import { normalizeScores, type RawScore } from "@/server/judging/normalization";
import { estimateBradleyTerry, type ComparisonInput } from "@/server/judging/bradleyterry";
import { round2 } from "@/server/util";
import type { Prisma } from "@prisma/client";

/**
 * Results engine (see JUDGING.md): raw → normalized (or pairwise) → rankings
 * → prize assignment. Fully computed from stored scores; never hardcoded.
 * Every run is persisted (EventResult + NormalizationRun) and reproducible.
 */

export interface ResultsPayload {
  mode: "RUBRIC" | "PAIRWISE";
  generatedAt: string;
  projects: {
    projectId: string;
    name: string;
    teamName: string;
    trackName: string | null;
    n: number;
    rawMean: number | null;
    normalizedMean: number | null;
    rawRank: number | null;
    normalizedRank: number | null;
    pairwiseScore: number | null;
    pairwiseRank: number | null;
    prizeIds: string[];
  }[];
  normalization: {
    stats: ReturnType<typeof normalizeScores>["stats"];
    rankShifts: number;
  } | null;
  prizeAssignments: { prizeId: string; prizeName: string; projectId: string | null }[];
  pairwise: { nu: number; iterations: number; isolated: string[] } | null;
}

function rankRows<T extends { key: string; score: number }>(rows: T[]): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const out = new Map<string, number>();
  let lastScore: number | null = null;
  let lastRank = 0;
  sorted.forEach((r, i) => {
    const rank = r.score === lastScore ? lastRank : i + 1;
    out.set(r.key, rank);
    lastScore = r.score;
    lastRank = rank;
  });
  return out;
}

export async function generateResults(eventId: string): Promise<ResultsPayload> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      projects: { include: { team: true, track: true } },
      prizes: true,
      rubric: { include: { criteria: true } },
    },
  });
  if (!event) throw new Error("event not found");
  const ev = event; // non-null for closures

  const judgements = await prisma.judgement.findMany({
    where: { project: { eventId } },
    select: { judgeId: true, projectId: true, weightedScore: true },
  });

  const raw: RawScore[] = judgements
    .filter((j) => j.weightedScore != null)
    .map((j) => ({ judgeId: j.judgeId, projectId: j.projectId, score: j.weightedScore! }));

  const projects = event.projects.filter((p) => p.status !== "DRAFT");
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // ── rubric mode: raw + normalized ──
  const byProjectRaw = new Map<string, number[]>();
  for (const r of raw) {
    if (!projectById.has(r.projectId)) continue;
    const list = byProjectRaw.get(r.projectId) ?? [];
    list.push(r.score);
    byProjectRaw.set(r.projectId, list);
  }
  const rawMeans = [...byProjectRaw.entries()].map(([projectId, xs]) => ({
    projectId,
    rawMean: round2(xs.reduce((a, b) => a + b, 0) / xs.length),
    n: xs.length,
  }));
  const rawRankMap = rankRows(rawMeans.map((m) => ({ key: m.projectId, score: m.rawMean })));

  const normalization = normalizeScores(raw.filter((r) => projectById.has(r.projectId)));
  const normMeanRows = normalization.projectSummary
    .filter((p) => projectById.has(p.projectId) && p.normalizedMean != null)
    .map((p) => ({ key: p.projectId, score: p.normalizedMean! }));
  const normRankMap = rankRows(normMeanRows);

  // how many projects changed position raw → normalized?
  let rankShifts = 0;
  for (const pid of projectById.keys()) {
    const r = rawRankMap.get(pid);
    const n = normRankMap.get(pid);
    if (r != null && n != null && r !== n) rankShifts++;
  }

  // ── pairwise mode ──
  let pairwise: ResultsPayload["pairwise"] = null;
  const pairwiseScore = new Map<string, number>();
  const pairwiseRank = new Map<string, number>();
  if (ev.judgingMode === "PAIRWISE") {
    const comps = await prisma.pairwiseComparison.findMany({ where: { eventId } });
    const inputs: ComparisonInput[] = comps.map((c) => ({
      projectA: c.projectA,
      projectB: c.projectB,
      winner: c.winner as "A" | "B" | "TIE",
    }));
    const bt = estimateBradleyTerry(
      inputs,
      projects.map((p) => p.id)
    );
    for (const row of bt.rankings) {
      pairwiseScore.set(row.projectId, row.score);
      pairwiseRank.set(row.projectId, row.rank);
    }
    pairwise = { nu: bt.nu, iterations: bt.iterations, isolated: bt.isolated };
  }

  // ── prize assignment (top-ranked eligible project per prize) ──
  const assignedProjects = new Set<string>();
  const prizeAssignments: ResultsPayload["prizeAssignments"] = [];
  const orderedPrizes = [...ev.prizes].sort((a, b) => a.rank - b.rank);

  function rankingFor(prizeTrackId: string | null): string[] {
    // ranked project ids for overall or track-scoped prize
    if (ev.judgingMode === "PAIRWISE") {
      return [...pairwiseRank.entries()]
        .filter(([pid]) => projectById.has(pid))
        .filter(([pid]) => (prizeTrackId ? projectById.get(pid)!.trackId === prizeTrackId : true))
        .sort((a, b) => a[1] - b[1])
        .map(([pid]) => pid);
    }
    const map = prizeTrackId
      ? rankRows(
          rawMeans
            .filter((m) => projectById.get(m.projectId)?.trackId === prizeTrackId)
            .map((m) => ({ key: m.projectId, score: m.rawMean }))
        )
      : rawRankMap;
    return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([pid]) => pid);
  }

  for (const prize of orderedPrizes) {
    const ranked = rankingFor(prize.trackId);
    const winner = ranked.find((pid) => !assignedProjects.has(pid)) ?? null;
    if (winner) assignedProjects.add(winner);
    prizeAssignments.push({ prizeId: prize.id, prizeName: prize.name, projectId: winner });
  }

  const payload: ResultsPayload = {
    mode: event.judgingMode,
    generatedAt: new Date().toISOString(),
    projects: projects.map((p) => {
      const rm = rawMeans.find((m) => m.projectId === p.id);
      const nm = normalization.projectSummary.find((m) => m.projectId === p.id);
      return {
        projectId: p.id,
        name: p.name,
        teamName: p.team.name,
        trackName: p.track?.name ?? null,
        n: rm?.n ?? 0,
        rawMean: rm?.rawMean ?? null,
        normalizedMean: nm?.normalizedMean ?? null,
        rawRank: rawRankMap.get(p.id) ?? null,
        normalizedRank: normRankMap.get(p.id) ?? null,
        pairwiseScore: pairwiseScore.get(p.id) ?? null,
        pairwiseRank: pairwiseRank.get(p.id) ?? null,
        prizeIds: prizeAssignments.filter((a) => a.projectId === p.id).map((a) => a.prizeId),
      };
    }),
    normalization: event.judgingMode === "RUBRIC" ? { stats: normalization.stats, rankShifts } : null,
    prizeAssignments,
    pairwise,
  };

  // persist reproducible snapshots
  await prisma.$transaction(async (tx) => {
    if (event.judgingMode === "RUBRIC") {
      await tx.normalizationRun.create({
        data: {
          eventId,
          method: "zscore_winsorized",
          paramsJson: {
            minScores: 5,
            winsorLimit: 2.5,
            map: "50 + 10z",
            raw: raw.length,
          },
          beforeJson: rawMeans as unknown as Prisma.InputJsonValue,
          afterJson: normalization.projectSummary as unknown as Prisma.InputJsonValue,
        },
      });
    }
    await tx.eventResult.create({
      data: { eventId, mode: event.judgingMode, published: false, payloadJson: payload as unknown as Prisma.InputJsonValue },
    });
  });

  return payload;
}

export async function latestResults(eventId: string) {
  const res = await prisma.eventResult.findFirst({
    where: { eventId },
    orderBy: { createdAt: "desc" },
  });
  return res;
}
