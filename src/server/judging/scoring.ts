export interface CriterionLike {
  criterionId: string;
  weight: number; // percent
  minScore: number;
  maxScore: number;
}

/**
 * Weighted score = Σ ((value - min) / (max - min)) × weight.
 *
 * Each criterion score is normalized to a 0..1 fraction of its own scale,
 * multiplied by the criterion weight (percent), and summed. The result is a
 * 0..100 score independent of per-criterion scales, so rubrics may safely mix
 * e.g. 1..5 and 0..10 criteria. Computed ONLY on the server; raw values are
 * stored on CriterionScore and the computed result on Judgement.weightedScore
 * so every result is reproducible.
 */
export function computeWeightedScore(
  scores: { criterionId: string; value: number }[],
  criteria: CriterionLike[]
): number {
  const byId = new Map(criteria.map((c) => [c.criterionId, c]));
  let total = 0;
  for (const s of scores) {
    const c = byId.get(s.criterionId);
    if (!c) continue;
    const span = c.maxScore - c.minScore;
    if (span <= 0) continue;
    const frac = Math.min(1, Math.max(0, (s.value - c.minScore) / span));
    total += frac * c.weight;
  }
  return Math.round(total * 100) / 100;
}
