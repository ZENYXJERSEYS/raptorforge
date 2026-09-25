import { describe, it, expect } from "vitest";
import { computeAssignments } from "@/server/judging/assignment";

const judges = [
  { id: "j1", userId: "u-j1", expertise: ["ai"], active: true },
  { id: "j2", userId: "u-j2", expertise: ["web"], active: true },
  { id: "j3", userId: "u-j3", expertise: [], active: true },
];

const projects = [
  { id: "p1", teamId: "t1", trackId: "tr-ai", memberUserIds: ["u-own1"] },
  { id: "p2", teamId: "t2", trackId: "tr-web", memberUserIds: ["u-own2"] },
  { id: "p3", teamId: "t3", trackId: "tr-ai", memberUserIds: ["u-own3"] },
];

const base = {
  projects,
  judges,
  judgesPerProject: 2,
  trackExpertise: { "tr-ai": ["ai"], "tr-web": ["web"] },
  seed: 12345,
};

describe("assignment engine", () => {
  it("is deterministic for identical inputs", () => {
    const a = computeAssignments(base);
    const b = computeAssignments(base);
    expect(a.decisions).toEqual(b.decisions);
    expect(a.load).toEqual(b.load);
  });

  it("changes output when the seed changes", () => {
    const a = computeAssignments(base);
    const b = computeAssignments({ ...base, seed: 999 });
    // extremely likely to differ; not mathematically guaranteed but stable for these inputs
    expect(JSON.stringify(a.decisions)).not.toBe(JSON.stringify(b.decisions));
  });

  it("never assigns a judge to their own team's project", () => {
    const own = { ...base, projects: [{ id: "p1", teamId: "t1", trackId: "tr-ai", memberUserIds: ["u-j1"] }] };
    const res = computeAssignments(own);
    for (const d of res.decisions) {
      expect(d.judgeId).not.toBe("j1");
    }
  });

  it("reports unassigned projects when there are not enough eligible judges", () => {
    const res = computeAssignments({
      ...base,
      projects: [{ id: "p1", teamId: "t1", trackId: "tr-ai", memberUserIds: ["u-j1"] }], // only j1 conflicts
      judgesPerProject: 3,
    });
    expect(res.unassigned.length).toBe(1);
    expect(res.unassigned[0].reason).toContain("Only 2 of 3");
  });

  it("balances workload across judges", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      teamId: `t${i}`,
      trackId: "tr-ai",
      memberUserIds: [`u-o${i}`],
    }));
    const res = computeAssignments({ ...base, projects: many, judgesPerProject: 3 });
    const loads = Object.values(res.load);
    const max = Math.max(...loads);
    const min = Math.min(...loads);
    expect(max - min).toBeLessThanOrEqual(1);
  });

  it("prefers track expertise when configured", () => {
    const res = computeAssignments({
      ...base,
      projects: [{ id: "p1", teamId: "t1", trackId: "tr-ai", memberUserIds: ["u-own1"] }],
      judgesPerProject: 1,
    });
    expect(res.decisions[0].judgeId).toBe("j1");
    expect(res.decisions[0].reason).toContain("track expertise match");
  });

  it("records a written reason for every assignment", () => {
    const res = computeAssignments(base);
    for (const d of res.decisions) {
      expect(d.reason).toMatch(/no conflict/);
    }
  });

  it("ignores inactive judges", () => {
    const res = computeAssignments({
      ...base,
      judges: [...judges, { id: "j4", userId: "u-j4", expertise: [], active: false }],
    });
    expect(res.load["j4"]).toBeUndefined();
  });
});
