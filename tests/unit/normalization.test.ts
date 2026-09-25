import { describe, it, expect } from "vitest";
import { normalizeScores, MIN_SCORES_FOR_NORMALIZATION } from "@/server/judging/normalization";

describe("cross-judge normalization", () => {
  it("demonstrates the flagship case: lenient vs harsh judge swap ranking", () => {
    // Judge A: lenient (mean 90) AND loose (σ ≈ 7.7); prefers Y over X by 8 raw points.
    // Judge B: harsh (mean 67.2) AND tight (σ ≈ 1.9); prefers X over Y by 4 raw points.
    // Raw mean favors Y (A's gap dominates); after re-centering, B's 4-point
    // preference is a large z-gap while A's 8 points barely move its own σ.
    const raw = [
      { judgeId: "A", projectId: "X", score: 90 },
      { judgeId: "A", projectId: "Y", score: 98 },
      { judgeId: "A", projectId: "Z", score: 80 },
      { judgeId: "A", projectId: "W", score: 85 },
      { judgeId: "A", projectId: "V", score: 97 },
      { judgeId: "B", projectId: "X", score: 70 },
      { judgeId: "B", projectId: "Y", score: 66 },
      { judgeId: "B", projectId: "Z", score: 68 },
      { judgeId: "B", projectId: "W", score: 67 },
      { judgeId: "B", projectId: "V", score: 65 },
    ];
    const out = normalizeScores(raw);
    const byProject = (pid: string) => out.scores.filter((s) => s.projectId === pid);

    // Raw means: X=80, Y=82 → Y ranks above X before normalization
    const rawX = byProject("X").reduce((a, s) => a + s.score, 0) / 2;
    const rawY = byProject("Y").reduce((a, s) => a + s.score, 0) / 2;
    expect(rawY).toBeGreaterThan(rawX);

    // Normalized: X ≈ 57.3, Y ≈ 52.1 → ranking flips
    const normX = byProject("X").reduce((a, s) => a + (s.normalized ?? 0), 0) / 2;
    const normY = byProject("Y").reduce((a, s) => a + (s.normalized ?? 0), 0) / 2;
    expect(normX).toBeGreaterThan(normY);
  });

  it("leaves judges with insufficient data un-normalized", () => {
    const raw = [
      { judgeId: "sparse", projectId: "X", score: 50 },
      { judgeId: "sparse", projectId: "Y", score: 90 },
    ];
    const out = normalizeScores(raw);
    expect(out.stats[0].status).toBe("insufficient-data");
    expect(out.scores.every((s) => s.normalized === null)).toBe(true);
    expect(MIN_SCORES_FOR_NORMALIZATION).toBeGreaterThan(2);
  });

  it("maps zero-variance judges to the scale mean", () => {
    const raw = [
      { judgeId: "flat", projectId: "X", score: 70 },
      { judgeId: "flat", projectId: "Y", score: 70 },
      { judgeId: "flat", projectId: "Z", score: 70 },
      { judgeId: "flat", projectId: "W", score: 70 },
      { judgeId: "flat", projectId: "V", score: 70 },
    ];
    const out = normalizeScores(raw);
    expect(out.stats[0].status).toBe("zero-variance");
    expect(out.scores.every((s) => s.normalized === 50)).toBe(true);
  });

  it("winsorizes extreme outliers to ±2.5σ", () => {
    // 8 identical scores + one extreme: raw z = 8/√9 ≈ 2.67 > 2.5 → must clamp.
    const raw = [
      ...["a", "b", "c", "d", "e", "f", "g", "h"].map((projectId) => ({ judgeId: "J", projectId, score: 50 })),
      { judgeId: "J", projectId: "outlier", score: 100 },
    ];
    const out = normalizeScores(raw);
    const z = out.scores.find((s) => s.projectId === "outlier")!.z!;
    expect(Math.abs(z)).toBeLessThanOrEqual(2.5);
    expect(z).toBe(2.5); // clamped, raw z was ≈2.67
  });

  it("is deterministic", () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      judgeId: i % 2 ? "A" : "B",
      projectId: `p${i % 5}`,
      score: 60 + ((i * 7) % 40),
    }));
    expect(normalizeScores(raw)).toEqual(normalizeScores(raw));
  });
});
