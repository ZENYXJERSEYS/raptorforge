import { describe, it, expect } from "vitest";
import { estimateBradleyTerry } from "@/server/judging/bradleyterry";

describe("bradley-terry estimator", () => {
  it("recovers a clear dominance ordering", () => {
    // p1 beats everyone; p2 beats p3/p4; p3 beats p4
    const comps = [
      { projectA: "p1", projectB: "p2", winner: "A" as const },
      { projectA: "p1", projectB: "p3", winner: "A" as const },
      { projectA: "p1", projectB: "p4", winner: "A" as const },
      { projectA: "p2", projectB: "p3", winner: "A" as const },
      { projectA: "p2", projectB: "p4", winner: "A" as const },
      { projectA: "p3", projectB: "p4", winner: "A" as const },
    ];
    const out = estimateBradleyTerry(comps, ["p1", "p2", "p3", "p4"]);
    expect(out.rankings[0].projectId).toBe("p1");
    expect(out.rankings[1].projectId).toBe("p2");
    expect(out.rankings[2].projectId).toBe("p3");
    expect(out.rankings[3].projectId).toBe("p4");
  });

  it("handles ties without collapsing strengths", () => {
    const comps = [
      { projectA: "a", projectB: "b", winner: "TIE" as const },
      { projectA: "b", projectB: "c", winner: "B" as const },
      { projectA: "a", projectB: "c", winner: "A" as const },
    ];
    const out = estimateBradleyTerry(comps, ["a", "b", "c"]);
    expect(out.rankings.length).toBe(3);
    expect(out.nu).toBeGreaterThan(0);
    expect(out.strengths.a).toBeGreaterThan(0);
  });

  it("flags isolated projects with zero comparisons", () => {
    const out = estimateBradleyTerry(
      [{ projectA: "a", projectB: "b", winner: "A" }],
      ["a", "b", "loner"]
    );
    expect(out.isolated).toContain("loner");
    expect(out.rankings.find((r) => r.projectId === "loner")?.comparisons).toBe(0);
  });

  it("is deterministic for fixed inputs", () => {
    const comps = Array.from({ length: 30 }, (_, i) => ({
      projectA: `p${i % 5}`,
      projectB: `p${(i + 1) % 5}`,
      winner: (i % 3 === 0 ? "TIE" : i % 2 ? "A" : "B") as "TIE" | "A" | "B",
    }));
    const a = estimateBradleyTerry(comps, ["p0", "p1", "p2", "p3", "p4"]);
    const b = estimateBradleyTerry(comps, ["p0", "p1", "p2", "p3", "p4"]);
    expect(a.strengths).toEqual(b.strengths);
    expect(a.iterations).toBe(b.iterations);
  });

  it("returns baseline strengths for an empty comparison set", () => {
    const out = estimateBradleyTerry([], ["x", "y"]);
    expect(Object.values(out.strengths)).toEqual([1, 1]);
    expect(out.isolated).toEqual(["x", "y"]);
  });
});
