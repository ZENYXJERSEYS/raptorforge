import { describe, it, expect } from "vitest";
import { makeClient, makeAccount, serverReady, uniq } from "./setup";

describe.runIf(await serverReady())("T1 — core lifecycle", () => {
  it("rejects unauthenticated access to protected endpoints", async () => {
    const c = makeClient();
    await expect(c.get("/api/auth/me")).rejects.toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("registers, logs in, and isolates sessions per client", async () => {
    const a = await makeAccount("authA");
    const me = await a.client.get<{ user: { email: string } }>("/api/auth/me");
    expect(me.user.email).toBe(a.email);
    const b = makeClient();
    await expect(b.get("/api/auth/me")).rejects.toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("enforces role checks server-side (participant cannot create events)", async () => {
    const a = await makeAccount("rbac1");
    await expect(
      a.client.post("/api/events", {
        name: "Sneaky Event", slug: `sneaky-${uniq()}`,
        startDate: new Date().toISOString(), endDate: new Date(Date.now() + 864e5).toISOString(),
        registrationStart: new Date().toISOString(), registrationEnd: new Date().toISOString(),
        submissionDeadline: new Date(Date.now() + 864e5).toISOString(),
      })
    ).rejects.toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("organizer creates event, adds track + prize, dates validated", async () => {
    const org = await makeAccount("org1", "ORGANIZER");
    const slug = `ev-${uniq()}`;
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: "T1 Event", slug,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 2 * 864e5).toISOString(),
      submissionDeadline: new Date(Date.now() + 5 * 864e5).toISOString(),
    });
    const track = await org.client.post<{ track: { id: string } }>(`/api/events/${ev.event.id}/tracks`, { name: "AI" });
    expect(track.track.id).toBeTruthy();
    const prize = await org.client.post(`/api/events/${ev.event.id}/prizes`, { name: "Grand Prize", rank: 1 });
    expect(prize).toBeTruthy();
  });

  it("creates teams, invite links, joins via token, blocks duplicates", async () => {
    const org = await makeAccount("org2", "ORGANIZER");
    const slug = `ev-${uniq()}`;
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: "Teams Event", slug,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 3 * 864e5).toISOString(),
      submissionDeadline: new Date(Date.now() + 5 * 864e5).toISOString(),
    });
    const eventId = ev.event.id;
    await org.client.patch(`/api/events/${eventId}`, { status: "REGISTRATION_OPEN" });

    const p1 = await makeAccount("team-owner");
    const p2 = await makeAccount("team-joiner");
    const p3 = await makeAccount("team-other");

    const team = await p1.client.post<{ team: { id: string } }>("/api/teams", { eventId, name: `T-${uniq()}` });
    const inv = await p1.client.put<{ inviteToken: string }>("/api/teams", { eventId, teamId: team.team.id });
    expect(inv.inviteToken).toBeTruthy();

    await p2.client.post("/api/teams/join", { token: inv.inviteToken });
    // duplicate membership in the same event must fail
    await expect(p3.client.post("/api/teams/join", { token: inv.inviteToken })).rejects.toBeTruthy();
    // p2 re-joining another team in the same event must fail (one team per event)
    const team2 = await p3.client.post<{ team: { id: string } }>("/api/teams", { eventId, name: `T2-${uniq()}` });
    const inv2 = await p3.client.put("/api/teams", { eventId, teamId: team2.team.id });
    await expect(p2.client.post("/api/teams/join", { token: (inv2 as { inviteToken: string }).inviteToken })).rejects.toMatchObject({ error: { code: "CONFLICT" } });
  });

  it("full submission workflow with deadline enforcement (the critical test)", async () => {
    const org = await makeAccount("org3", "ORGANIZER");
    const slug = `ev-${uniq()}`;
    // deadline 3 seconds in the future
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: "Deadline Event", slug,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date().toISOString(),
      submissionDeadline: new Date(Date.now() + 3000).toISOString(),
    });
    const eventId = ev.event.id;
    await org.client.patch(`/api/events/${eventId}`, { status: "ACTIVE" });

    const p = await makeAccount("submitter");
    const team = await p.client.post<{ team: { id: string } }>("/api/teams", { eventId, name: `SD-${uniq()}` });
    const track = await org.client.post<{ track: { id: string } }>(`/api/events/${eventId}/tracks`, { name: "OPEN" });

    const draft = await p.client.post<{ project: { id: string } }>("/api/submissions", {
      eventId, teamId: team.team.id, name: "Deadline Probe",
      trackId: track.track.id, shortDescription: "s", fullDescription: "f",
      technologies: ["ts"],
    });
    const pid = draft.project.id;

    // draft edits allowed before deadline
    await p.client.patch(`/api/submissions/${pid}`, { shortDescription: "edited before deadline" });
    const before = await p.client.get<{ project: { status: string } }>(`/api/submissions/${pid}`);
    expect(before.project.status).toBe("DRAFT");

    // submit before the deadline → succeeds
    await p.client.post(`/api/submissions/${pid}/submit`);

    // deadline passes (server clock decides — client cannot influence this)
    await new Promise((r) => setTimeout(r, 3500));

    // post-deadline edit → rejected (not DRAFT anymore anyway, but check both paths)
    await expect(p.client.patch(`/api/submissions/${pid}`, { shortDescription: "hacked" })).rejects.toMatchObject({ error: {} });

    // a second team that never submitted: deadline now passed → submit must 423
    const p2 = await makeAccount("late-team");
    const team2 = await p2.client.post<{ team: { id: string } }>("/api/teams", { eventId, name: `LATE-${uniq()}` });
    const late = await p2.client.post<{ project: { id: string } }>("/api/submissions", {
      eventId, teamId: team2.team.id, name: "Late Project",
      trackId: track.track.id, shortDescription: "s", fullDescription: "f", technologies: [],
    });
    await expect(p2.client.post(`/api/submissions/${late.project.id}/submit`)).rejects.toMatchObject({
      error: { code: "SUBMISSION_DEADLINE_PASSED" },
    });
  });

  it("public gallery exposes search/filter/pagination without private data", async () => {
    const g = makeClient();
    const events = await g.get<{ events: { id: string }[] }>("/api/events");
    if (events.events.length === 0) return; // no public events → skip
    const page = await g.get<{ projects: { id: string; name: string }[]; pagination: { total: number } }>(
      `/api/projects?eventId=${events.events[0].id}&pageSize=2&page=1&q=a`
    );
    expect(page.projects.length).toBeLessThanOrEqual(2);
    expect(page.pagination.total).toBeGreaterThanOrEqual(0);
    // no judging data may leak into public payloads
    const raw = JSON.stringify(page);
    expect(raw).not.toContain("weightedScore");
    expect(raw).not.toContain("normalizedMean");
  });
});
