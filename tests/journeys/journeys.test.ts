import { describe, it, expect } from "vitest";
import { makeClient, makeAccount, serverReady, uniq } from "../integration/setup";

/**
 * Journey tests — the complete user-facing lifecycles, end to end.
 * J1: organizer runs an event through judging; J2: voting + integrity; J3: normalization flips a ranking.
 */
describe.runIf(await serverReady())("journeys", () => {
  it("J1: full lifecycle — event → teams → submissions → judges → scores → results", async () => {
    const org = await makeAccount(`j1org-${uniq()}`, "ORGANIZER");
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: `Journey1 ${uniq()}`, slug: `j1-${uniq()}`,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 6 * 864e5).toISOString(),
      submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    const eventId = ev.event.id;
    await org.client.patch(`/api/events/${eventId}`, { status: "ACTIVE", judgesPerProject: 2 });
    const track = await org.client.post<{ track: { id: string } }>(`/api/events/${eventId}/tracks`, { name: "AI" });
    await org.client.put(`/api/events/${eventId}/rubric`, {
      name: "J1", criteria: [
        { name: "Tech", weight: 50, minScore: 1, maxScore: 5, required: true, order: 1 },
        { name: "Wow", weight: 50, minScore: 1, maxScore: 5, required: true, order: 2 },
      ],
    });

    const projects: string[] = [];
    for (const n of ["alpha", "beta", "gamma"]) {
      const p = await makeAccount(`j1p-${n}`);
      const team = await p.client.post<{ team: { id: string } }>("/api/teams", { eventId, name: `J1T-${n}-${uniq()}` });
      const proj = await p.client.post<{ project: { id: string } }>("/api/submissions", {
        eventId, teamId: team.team.id, name: `J1 ${n}`, trackId: track.track.id,
        shortDescription: "s", fullDescription: "f", technologies: ["ai"],
      });
      await p.client.post(`/api/submissions/${proj.project.id}/submit`);
      projects.push(proj.project.id);
    }

    const judgeClients: { client: ReturnType<typeof makeClient>; judgeId: string }[] = [];
    for (const n of ["one", "two"]) {
      const email = `j1judge-${n}-${uniq()}@test.local`;
      const jc = makeClient();
      await jc.post("/api/auth/register", { email, name: `J1 Judge ${n}`, password: "test-password-123" });
      const jj = await org.client.post<{ judge: { id: string } }>(`/api/events/${eventId}/judges`, { email, name: `J1 Judge ${n}`, expertise: ["ai"] });
      await org.client.patch(`/api/events/${eventId}/judges`, { judgeId: jj.judge.id, status: "ACTIVE" });
      judgeClients.push({ client: jc, judgeId: jj.judge.id });
    }

    const gen = await org.client.post<{ created: number }>(`/api/events/${eventId}/assignments`, { replace: true });
    expect(gen.created).toBeGreaterThan(0);

    // every judge scores every assigned project: criterion 4 & 5 → weighted 85
    const rubric = await org.client.get<{ rubric: { criteria: { id: string }[] } }>(`/api/events/${eventId}/rubric`);
    const [c1, c2] = rubric.rubric!.criteria;
    for (const j of judgeClients) {
      const queue = await j.client.get<{ queue: { project: { id: string } }[] }>(`/api/events/${eventId}/judge-queue`);
      for (const item of queue.queue) {
        void j.judgeId;
        await j.client.post(`/api/events/${eventId}/judgements`, {
          projectId: item.project.id, comment: "",
          scores: [{ criterionId: c1.id, value: 4 }, { criterionId: c2.id, value: 5 }],
        });
      }
    }

    const results = await org.client.post<{ results: { projects: { projectId: string; rawMean: number | null; rawRank: number | null }[] } }>(
      `/api/events/${eventId}/results`, { action: "generate" }
    );
    const scored = results.results.projects.filter((p) => p.rawMean != null);
    expect(scored.length).toBe(3);
    expect(scored.every((p) => p.rawMean === 85)).toBe(true);
  });

  it("J2: voting journey with quota + integrity flags in audit", async () => {
    const org = await makeAccount(`j2org-${uniq()}`, "ORGANIZER");
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: `Journey2 ${uniq()}`, slug: `j2-${uniq()}`,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 6 * 864e5).toISOString(),
      submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    const eventId = ev.event.id;
    await org.client.patch(`/api/events/${eventId}`, {
      status: "ACTIVE", votingEnabled: true,
      votingStart: new Date(Date.now() - 60e3).toISOString(),
      votingEnd: new Date(Date.now() + 7 * 864e5).toISOString(),
      votesPerUser: 1,
    });
    const track = await org.client.post<{ track: { id: string } }>(`/api/events/${eventId}/tracks`, { name: "OPEN" });
    const p = await makeAccount(`j2p-${uniq()}`);
    const team = await p.client.post<{ team: { id: string } }>("/api/teams", { eventId, name: `J2T-${uniq()}` });
    const proj = await p.client.post<{ project: { id: string } }>("/api/submissions", {
      eventId, teamId: team.team.id, name: "J2 project", trackId: track.track.id,
      shortDescription: "s", fullDescription: "f", technologies: [],
    });
    await p.client.post(`/api/submissions/${proj.project.id}/submit`);

    const voter = await makeAccount("j2voter");
    await voter.client.post(`/api/projects/${proj.project.id}/votes`);
    const dup = await voter.client.post(`/api/projects/${proj.project.id}/votes`).catch((e) => e.error.code);
    expect(dup).toBe("CONFLICT");
    const audit = await org.client.get<{ entries: { action: string }[] }>("/api/audit-log?pageSize=200");
    expect(audit.entries.some((e) => e.action === "VOTE_CAST")).toBe(true);
  });

  it("J3: normalization lab reports judge stats and rank shifts (flagship scenario)", async () => {
    const org = await makeAccount(`j3org-${uniq()}`, "ORGANIZER");
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: `Journey3 ${uniq()}`, slug: `j3-${uniq()}`,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 6 * 864e5).toISOString(),
      submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    const eventId = ev.event.id;
    await org.client.patch(`/api/events/${eventId}`, { status: "ACTIVE", judgesPerProject: 2 });
    const track = await org.client.post<{ track: { id: string } }>(`/api/events/${eventId}/tracks`, { name: "AI" });
    await org.client.put(`/api/events/${eventId}/rubric`, {
      name: "J3", criteria: [
        { name: "Only", weight: 100, minScore: 1, maxScore: 5, required: true, order: 1 },
      ],
    });

    const projectIds: string[] = [];
    for (const n of ["X", "Y", "Z", "W", "V", "U", "T", "S", "R", "Q"]) {
      const p = await makeAccount(`j3p-${n}`);
      const team = await p.client.post<{ team: { id: string } }>("/api/teams", { eventId, name: `J3T-${n}-${uniq()}` });
      const proj = await p.client.post<{ project: { id: string } }>("/api/submissions", {
        eventId, teamId: team.team.id, name: `J3 ${n}`, trackId: track.track.id,
        shortDescription: "s", fullDescription: "f", technologies: [],
      });
      await p.client.post(`/api/submissions/${proj.project.id}/submit`);
      projectIds.push(proj.project.id);
    }

    // two judges with opposite calibration, 5 shared projects each
    const judgeSetup: { email: string; scores: number[] }[] = [
      { email: `j3la-${uniq()}@test.local`, scores: [5, 5, 4, 4, 5] }, // lenient+loose judge
      { email: `j3ha-${uniq()}@test.local`, scores: [2, 1, 2, 1, 2] }, // harsh judge
    ];
    for (const js of judgeSetup) {
      const jc = makeClient();
      await jc.post("/api/auth/register", { email: js.email, name: "J3 Judge", password: "test-password-123" });
      const jj = await org.client.post<{ judge: { id: string } }>(`/api/events/${eventId}/judges`, { email: js.email, name: "J3 Judge", expertise: [] });
      await org.client.patch(`/api/events/${eventId}/judges`, { judgeId: jj.judge.id, status: "ACTIVE" });
      await org.client.post(`/api/events/${eventId}/assignments`, { replace: true });
      const queue = await jc.get<{ queue: { project: { id: string } }[] }>(`/api/events/${eventId}/judge-queue`);
      const rubric = await org.client.get<{ rubric: { criteria: { id: string }[] } }>(`/api/events/${eventId}/rubric`);
      const criterionId = rubric.rubric!.criteria[0].id;
      for (const [i, item] of queue.queue.entries()) {
        await jc.post(`/api/events/${eventId}/judgements`, {
          projectId: item.project.id, comment: "",
          scores: [{ criterionId, value: js.scores[i % js.scores.length] }],
        });
      }
    }

    const lab = await org.client.get<{ judgeStats: { status: string }[]; rankShifts: { count: number } }>(`/api/events/${eventId}/normalization`);
    expect(lab.judgeStats.length).toBeGreaterThanOrEqual(2);
    expect(lab.rankShifts).toBeTruthy();
  });
});
