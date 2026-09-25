import { round2 } from "@/server/util";

export const MIN_SCORES_FOR_NORMALIZATION = 5;
export const WINSOR_LIMIT = 2.5;
export const MAP_MEAN = 50;
export const MAP_SPAN = 10;

export interface RawScore {
  judgeId: string;
  projectId: string;
  score: number;
}

export interface JudgeStats {
  judgeId: string;
  n: number;
  mean: number;
  sigma: number;
  status: "normalized" | "insufficient-data" | "zero-variance";
}

export interface NormalizedScore extends RawScore {
  z: number | null;
  normalized: number | null;
  note?: string;
}

export interface NormalizationOutput {
  stats: JudgeStats[];
  scores: NormalizedScore[];
  projectSummary: {
    projectId: string;
    rawMean: number | null;
    normalizedMean: number | null;
    n: number;
  }[];
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sigma(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Cross-judge normalization (full methodology in JUDGING.md).
 *
 * Judges calibrate differently (a 91-average judge and a 68-average judge may
 * agree on which project is better). Method:
 *   z = (x - judgeMean) / judgeSigma  over each judge's completed judgements
 * then map z → 0..100 via fixed linear transform: 50 + 10·z.
 *
 * Deterministic edge handling:
 *  - judge with < MIN_SCORES_FOR_NORMALIZATION completed judgements: left raw,
 *    marked "insufficient-data", excluded from normalization claims;
 *  - judge sigma = 0 (identical scores): z = 0 (judge mean), "zero-variance";
 *  - z winsorized to ±WINSOR_LIMIT to cap outlier influence;
 *  - no interpolation across missing scores — only completed judgements count.
 *
 * Pure and deterministic: same input, same output.
 */
export function normalizeScores(raw: RawScore[]): NormalizationOutput {
  const byJudge = new Map<string, number[]>();
  for (const r of raw) {
    const list = byJudge.get(r.judgeId) ?? [];
    list.push(r.score);
    byJudge.set(r.judgeId, list);
  }

  const stats: JudgeStats[] = [];
  for (const [judgeId, xs] of byJudge) {
    const s = sigma(xs);
    stats.push({
      judgeId,
      n: xs.length,
      mean: round2(mean(xs)),
      sigma: round2(s),
      status: xs.length < MIN_SCORES_FOR_NORMALIZATION
        ? "insufficient-data"
        : s === 0
          ? "zero-variance"
          : "normalized",
    });
  }
  const statById = new Map(stats.map((s) => [s.judgeId, s]));

  const scores: NormalizedScore[] = raw.map((r) => {
    const st = statById.get(r.judgeId)!;
    if (st.status === "insufficient-data") {
      return { ...r, z: null, normalized: null, note: "insufficient-data (left raw)" };
    }
    if (st.status === "zero-variance") {
      return { ...r, z: 0, normalized: MAP_MEAN, note: "zero-variance (mapped to scale mean)" };
    }
    let z = (r.score - st.mean) / st.sigma;
    if (z > WINSOR_LIMIT) { z = WINSOR_LIMIT; }
    else if (z < -WINSOR_LIMIT) { z = -WINSOR_LIMIT; }
    return { ...r, z: round2(z), normalized: round2(MAP_MEAN + MAP_SPAN * z) };
  });

  const byProject = new Map<string, NormalizedScore[]>();
  for (const s of scores) {
    const list = byProject.get(s.projectId) ?? [];
    list.push(s);
    byProject.set(s.projectId, list);
  }

  const projectSummary = [...byProject.entries()].map(([projectId, list]) => {
    const raws = list.map((l) => l.score);
    const norms = list.map((l) => l.normalized).filter((n): n is number => n != null);
    return {
      projectId,
      rawMean: round2(mean(raws)),
      normalizedMean: norms.length ? round2(mean(norms)) : null,
      n: list.length,
    };
  });

  return { stats, scores, projectSummary };
}
