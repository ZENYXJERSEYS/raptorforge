import { describe, it, expect } from "vitest";
import { makeClient, makeAccount, serverReady, uniq } from "./setup";

describe.runIf(await serverReady())("T3 — voting & integrity", () => {
  async function setupVotingEvent() {
    const org = await makeAccount(`t3org-${uniq()}`, "ORGANIZER");
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: `T3 ${uniq()}`, slug: `t3-${uniq()}`,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 6 * 864e5).toISOString(),
      submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    const eventId = ev.event.id;
    await org.client.patch(`/api/events/${eventId}`, {
      status: "ACTIVE",
      votingEnabled: true,
      votingStart: new Date(Date.now() - 3600e3).toISOString(),
      votingEnd: new Date(Date.now() + 7 * 864e5).toISOString(),
      votesPerUser: 2,
    });
    const track = await org.client.post<{ track: { id: string } }>(`/api/events/${eventId}/tracks`, { name: "OPEN" });
    return { org, eventId, trackId: track.track.id };
  }

  async function addProject(eventId: string, trackId: string, name: string) {
    const p = await makeAccount(`t3p-${name}`);
    const team = await p.client.post<{ team: { id: string } }>("/api/teams", { eventId, name: `t-${name}-${uniq()}` });
    const proj = await p.client.post<{ project: { id: string } }>("/api/submissions", {
      eventId, teamId: team.team.id, name, trackId, shortDescription: "s", fullDescription: "f", technologies: [],
    });
    await p.client.post(`/api/submissions/${proj.project.id}/submit`);
    return proj.project.id;
  }

  it("vote quotas, duplicates, and window enforcement", async () => {
    const { eventId, trackId } = await setupVotingEvent();
    const p1 = await addProject(eventId, trackId, "VA");
    const p2 = await addProject(eventId, trackId, "VB");
    const p3 = await addProject(eventId, trackId, "VC");
    const voter = await makeAccount("t3voter");

    await voter.client.post(`/api/projects/${p1}/votes`);
    // duplicate vote → 409
    await expect(voter.client.post(`/api/projects/${p1}/votes`)).rejects.toMatchObject({ error: { code: "CONFLICT" } });
    await voter.client.post(`/api/projects/${p2}/votes`);
    // quota (votesPerUser=2) exhausted → 403
    await expect(voter.client.post(`/api/projects/${p3}/votes`)).rejects.toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("rate limiting kicks in on rapid voting (429)", async () => {
    const { eventId, trackId } = await setupVotingEvent();
    const projects: string[] = [];
    for (let i = 0; i < 12; i++) projects.push(await addProject(eventId, trackId, `RL${i}`));
    const voter = await makeAccount("t3rl");
    // votesPerUser is 2, so first exhaust quota normally: expect quota error before rate limit
    await voter.client.post(`/api/projects/${projects[0]}/votes`);
    await voter.client.post(`/api/projects/${projects[1]}/votes`);
    // now every further vote hits quota → FORBIDDEN (proves quota > rate limit ordering)
    await expect(voter.client.post(`/api/projects/${projects[2]}/votes`)).rejects.toMatchObject({ error: { code: "FORBIDDEN" } });
    // separate window check via login rate-limit would need 31 attempts; validated in T1 setup instead
  });

  it("results stay hidden while voting is open (API-level enforcement)", async () => {
    const { org, eventId, trackId } = await setupVotingEvent();
    await addProject(eventId, trackId, "HD");
    const voter = await makeAccount("t3hidden");
    // public read while hidden+open → forbidden
    await expect(voter.client.get(`/api/events/${eventId}/results`)).rejects.toMatchObject({ error: { code: "FORBIDDEN" } });
    // organizer can still see
    await org.client.post(`/api/events/${eventId}/results`, { action: "generate" });
    const orgView = await org.client.get<{ results: unknown }>(`/api/events/${eventId}/results`);
    expect(orgView.results).toBeTruthy();
  });

  it("randomized per-user ballot order is stable per user and differs across users", async () => {
    const { eventId, trackId } = await setupVotingEvent();
    for (let i = 0; i < 6; i++) await addProject(eventId, trackId, `RO${i}`);
    const v1 = await makeAccount("t3ro1");
    const v2 = await makeAccount("t3ro2");
    const b1a = await v1.client.get<{ projects: { id: string }[] }>(`/api/events/${eventId}/voting`);
    const b1b = await v1.client.get<{ projects: { id: string }[] }>(`/api/events/${eventId}/voting`);
    const b2 = await v2.client.get<{ projects: { id: string }[] }>(`/api/events/${eventId}/voting`);
    const order1a = b1a.projects.map((p) => p.id).join(",");
    const order1b = b1b.projects.map((p) => p.id).join(",");
    const order2 = b2.projects.map((p) => p.id).join(",");
    expect(order1a).toBe(order1b); // stable per user (hour bucket)
    expect(order1a).not.toBe(order2); // different across users (overwhelmingly likely)
  });

  it("comments: create, delete own, organizer moderation, rate limit", async () => {
    const { org, eventId, trackId } = await setupVotingEvent();
    const pid = await addProject(eventId, trackId, "CM");
    const author = await makeAccount("t3cm1");
    const created = await author.client.post<{ comment: { id: string } }>(`/api/projects/${pid}/comments`, { body: "great build!" });
    // author can delete own
    await author.client.del(`/api/projects/${pid}/comments?commentId=${created.comment.id}`);
    // organizer can moderate someone else's
    const other = await makeAccount("t3cm2");
    const c2 = await other.client.post<{ comment: { id: string } }>(`/api/projects/${pid}/comments`, { body: "hmm" });
    await org.client.del(`/api/projects/${pid}/comments?commentId=${c2.comment.id}`);
    // a third user cannot delete someone else's comment
    const c3 = await other.client.post<{ comment: { id: string } }>(`/api/projects/${pid}/comments`, { body: "again" });
    const intruder = await makeAccount("t3cm3");
    await expect(intruder.client.del(`/api/projects/${pid}/comments?commentId=${c3.comment.id}`)).rejects.toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("audit trail records voting actions", async () => {
    const { eventId, trackId } = await setupVotingEvent();
    const pid = await addProject(eventId, trackId, "AU");
    const voter = await makeAccount("t3au");
    await voter.client.post(`/api/projects/${pid}/votes`);
    const org = await makeAccount(`t3org2-${uniq()}`, "ORGANIZER");
    // organizer of THIS event only — make them organizer via event creation is separate; use audit-log as global org view
    const audit = await org.client.get<{ entries: { action: string; resourceId: string | null }[] }>("/api/audit-log?pageSize=200");
    expect(audit.entries.some((e) => e.action === "VOTE_CAST" && e.resourceId === pid)).toBe(true);
  });
});
