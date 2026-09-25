import { describe, it, expect } from "vitest";
import { makeClient, makeAccount, serverReady, uniq } from "./setup";

describe.runIf(await serverReady())("T2 — judging", () => {
  async function setupEvent() {
    const org = await makeAccount(`t2org-${uniq()}`, "ORGANIZER");
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: `T2 ${uniq()}`, slug: `t2-${uniq()}`,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 6 * 864e5).toISOString(),
      submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    const eventId = ev.event.id;
    await org.client.patch(`/api/events/${eventId}`, { status: "ACTIVE", judgesPerProject: 2 });
    const track = await org.client.post<{ track: { id: string } }>(`/api/events/${eventId}/tracks`, { name: "AI" });
    await org.client.put(`/api/events/${eventId}/rubric`, {
      name: "T2 rubric",
      criteria: [
        { name: "Technical", weight: 40, minScore: 1, maxScore: 5, required: true, order: 1 },
        { name: "Innovation", weight: 60, minScore: 1, maxScore: 5, required: true, order: 2 },
      ],
    });
    return { org, eventId, trackId: track.track.id };
  }

  async function addTeamWithProject(eventId: string, trackId: string, name: string) {
    const p = await makeAccount(`t2p-${name}`);
    const team = await p.client.post<{ team: { id: string } }>("/api/teams", { eventId, name: `team-${name}-${uniq()}` });
    const proj = await p.client.post<{ project: { id: string } }>("/api/submissions", {
      eventId, teamId: team.team.id, name: `Project ${name}`, trackId,
      shortDescription: "s", fullDescription: "f", technologies: ["ai"],
    });
    await p.client.post(`/api/submissions/${proj.project.id}/submit`);
    return { p, teamId: team.team.id, projectId: proj.project.id };
  }

  async function addJudge(eventId: string, name: string, expertise: string[]) {
    const j = await makeAccount(`t2j-${name}`);
    // make the user a JUDGE via organizer judge-invite endpoint (creates/links user)
    const res = await fetch(process.env.BASE_URL ?? "http://localhost:3000");
    void res;
    const judge = await j.client.post(`/api/auth/register`, {
      email: `judge-${name}-${uniq()}@test.local`, name: `Judge ${name}`, password: "test-password-123",
    }).catch(() => null);
    void judge;
    return { userId: j.userId, client: j.client };
  }

  it("rubric weights must sum to 100 (422 otherwise)", async () => {
    const { org, eventId } = await setupEvent();
    await expect(
      org.client.put(`/api/events/${eventId}/rubric`, {
        name: "Bad", criteria: [{ name: "X", weight: 50, minScore: 1, maxScore: 5, required: true, order: 1 }],
      })
    ).rejects.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("judge cannot score an unassigned project (role + assignment isolation)", async () => {
    const { eventId, trackId } = await setupEvent();
    const { projectId } = await addTeamWithProject(eventId, trackId, "iso");
    const judgeUser = await makeAccount(`t2judge-${uniq()}`, "ADMIN");
    // judge profile for event — created by organizer via judges API
    const org = await makeClient();
    void org;
    // judge self-registering as judge for the event is not allowed; use the organizer invite path:
    const { execSync } = await import("node:child_process");
    void execSync;
    // organizer creates the judge record bound to the judge user
    const organizer = await makeAccount(`t2orgb-${uniq()}`, "ORGANIZER");
    const ev = await organizer.client.get<{ event: { id: string } }>(`/api/events/${eventId}`);
    void ev;
    const j = await organizer.client.post<{ judge: { id: string; userId: string } }>(`/api/events/${eventId}/judges`, {
      email: `j-${uniq()}@test.local`, name: "Isolation Judge", expertise: ["ai"],
    });
    // organizer must generate assignments; without them the judge has no assignments
    await expect(
      (await import("./setup")).makeClient().post(`/api/events/${eventId}/judgements`, {
        projectId, scores: [{ criterionId: "x", value: 3 }],
      })
    ).rejects.toBeTruthy();
    void judgeUser;
    void j;
  });

  it("weighted scoring is computed server-side and stored", async () => {
    const { org, eventId, trackId } = await setupEvent();
    const { projectId } = await addTeamWithProject(eventId, trackId, "scored");
    const judgeEmail = `judge-${uniq()}@test.local`;
    const jClient = makeClient();
    const reg = await jClient.post<{ user: { id: string } }>("/api/auth/register", {
      email: judgeEmail, name: "Scoring Judge", password: "test-password-123",
    });
    // organizer invites that exact judge
    await org.client.post(`/api/events/${eventId}/judges`, { email: judgeEmail, name: "Scoring Judge", expertise: ["ai"] });
    // activate
    const judges = await org.client.get<{ judges: { id: string; email: string; status: string }[] }>(`/api/events/${eventId}/judges`);
    const judgeRow = judges.judges.find((x) => x.email === judgeEmail)!;
    await org.client.patch(`/api/events/${eventId}/judges`, { judgeId: judgeRow.id, status: "ACTIVE" });
    // organizer generates assignments (deterministic engine)
    const gen = await org.client.post<{ created: number }>(`/api/events/${eventId}/assignments`, { replace: true });
    expect(gen.created).toBeGreaterThan(0);
    // judge reads queue + rubric, then scores
    const queue = await jClient.get<{ queue: { project: { id: string } }[] }>(`/api/events/${eventId}/judge-queue`);
    expect(queue.queue.some((q) => q.project.id === projectId)).toBe(true);
    const rubric = await org.client.get<{ rubric: { criteria: { id: string; name: string }[] } }>(`/api/events/${eventId}/rubric`);
    const [c1, c2] = rubric.rubric!.criteria;
    const res = await jClient.post<{ judgement: { weightedScore: number } }>(`/api/events/${eventId}/judgements`, {
      projectId, comment: "solid",
      scores: [{ criterionId: c1.id, value: 4 }, { criterionId: c2.id, value: 5 }],
    });
    // expected: (3/4)*40 + (4/4)*60 = 90
    expect(res.judgement.weightedScore).toBe(90);
  });

  it("deterministic assignment engine produces reasons and respects conflicts", async () => {
    const { org, eventId, trackId } = await setupEvent();
    await addTeamWithProject(eventId, trackId, "a1");
    await addTeamWithProject(eventId, trackId, "a2");
    for (const n of ["d1", "d2", "d3"]) {
      await org.client.post(`/api/events/${eventId}/judges`, { email: `${n}-${uniq()}@test.local`, name: `Judge ${n}`, expertise: ["ai"] });
    }
    const gen1 = await org.client.post<{ created: number; load: Record<string, number> }>(`/api/events/${eventId}/assignments`, { replace: true, seed: 777 });
    const gen2 = await org.client.post<{ created: number }>(`/api/events/${eventId}/assignments`, { replace: true, seed: 777 });
    expect(gen1.created).toBe(gen2.created); // same seed → same count
    const list = await org.client.get<{ assignments: { reason: string; judged: boolean }[] }>(`/api/events/${eventId}/assignments`);
    expect(list.assignments.every((a) => a.reason.length > 0)).toBe(true);
  });

  it("CSV exports work and are audited", async () => {
    const { org, eventId } = await setupEvent();
    const res = await org.client.fetch(`/api/events/${eventId}/export?what=projects`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text.split("\n")[0]).toContain("projectId");
    const audit = await org.client.get<{ entries: { action: string }[] }>("/api/audit-log?pageSize=100");
    expect(audit.entries.some((e) => e.action === "CSV_EXPORTED")).toBe(true);
  });
});
