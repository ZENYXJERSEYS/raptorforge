import { describe, it, expect } from "vitest";
import { computeWeightedScore } from "@/server/judging/scoring";

const rubric = [
  { criterionId: "tech", weight: 30, minScore: 1, maxScore: 5 },
  { criterionId: "innov", weight: 25, minScore: 1, maxScore: 5 },
  { criterionId: "impact", weight: 20, minScore: 1, maxScore: 5 },
  { criterionId: "ux", weight: 15, minScore: 1, maxScore: 5 },
  { criterionId: "complete", weight: 10, minScore: 1, maxScore: 5 },
];

describe("weighted scoring", () => {
  it("computes the spec example: 4,5,4,3 with mixed weights", () => {
    const score = computeWeightedScore(
      [
        { criterionId: "tech", value: 4 },
        { criterionId: "innov", value: 5 },
        { criterionId: "impact", value: 4 },
        { criterionId: "ux", value: 3 },
        { criterionId: "complete", value: 4 },
      ],
      rubric
    );
    // (3/4)*30 + (4/4)*25 + (3/4)*20 + (2/4)*15 + (3/4)*10 = 22.5+25+15+7.5+7.5
    expect(score).toBe(77.5);
  });

  it("yields 0 at the minimum and 100 at the maximum", () => {
    const min = computeWeightedScore(rubric.map((c) => ({ criterionId: c.criterionId, value: c.minScore })), rubric);
    const max = computeWeightedScore(rubric.map((c) => ({ criterionId: c.criterionId, value: c.maxScore })), rubric);
    expect(min).toBe(0);
    expect(max).toBe(100);
  });

  it("handles mixed scales (1..5 and 0..10) consistently", () => {
    const mixed = [
      { criterionId: "a", weight: 50, minScore: 1, maxScore: 5 },
      { criterionId: "b", weight: 50, minScore: 0, maxScore: 10 },
    ];
    // a=3 → 0.5 fraction; b=5 → 0.5 fraction; both contribute half their weight
    const score = computeWeightedScore([{ criterionId: "a", value: 3 }, { criterionId: "b", value: 5 }], mixed);
    expect(score).toBe(50);
  });

  it("clamps out-of-range inputs instead of extrapolating", () => {
    const score = computeWeightedScore([{ criterionId: "tech", value: 999 }], [{ criterionId: "tech", weight: 100, minScore: 1, maxScore: 5 }]);
    expect(score).toBe(100);
  });

  it("ignores unknown criteria defensively", () => {
    const score = computeWeightedScore([{ criterionId: "ghost", value: 5 }], rubric);
    expect(score).toBe(0);
  });
});
