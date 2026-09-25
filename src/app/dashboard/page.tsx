"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Spinner, EmptyState, ErrorState, Notice, useToast } from "@/components/states";
import { SiteHeader } from "@/components/site-header";

interface Me { user: { id: string; name: string; role: string }; memberships: { id: string; name: string; eventId: string }[] }
interface EventDto { id: string; name: string; slug: string; status: string; submissionDeadline: string; votingEnabled: boolean; votingEnd: string | null }
interface Submission { id: string; name: string; status: string; team: { name: string }; track: { name: string } | null; updatedAt: string; eventId: string }
interface TeamDto { id: string; name: string; eventId: string; memberCount: number; hasProject: boolean; members: { userId: string; name: string; role: string }[] }

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [invite, setInvite] = useState<{ teamId: string; token: string } | null>(null);
  const [joinToken, setJoinToken] = useState("");
  const [newTeam, setNewTeam] = useState<{ eventId: string; name: string }>({ eventId: "", name: "" });
  const { show, node } = useToast();

  const load = useCallback(async () => {
    setState("loading");
    try {
      const meRes = await api<Me>("/api/auth/me");
      setMe(meRes);
      const evRes = await api<{ events: EventDto[] }>("/api/events");
      setEvents(evRes.events);
      const subRes = await api<{ submissions: Submission[] }>("/api/submissions");
      setSubmissions(subRes.submissions);
      if (evRes.events[0]) {
        const teamRes = await api<{ teams: TeamDto[] }>(`/api/teams?eventId=${evRes.events[0].id}`);
        setTeams(teamRes.teams);
        setNewTeam((n) => ({ ...n, eventId: evRes.events[0].id }));
      }
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Failed to load");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createTeam() {
    try {
      await api("/api/teams", { method: "POST", body: newTeam });
      show("Team created");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function makeInvite(teamId: string) {
    try {
      const res = await api<{ inviteToken: string }>("/api/teams", { method: "PUT", body: { eventId: newTeam.eventId, teamId } });
      setInvite({ teamId, token: res.inviteToken });
      show("Invite link created");
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function join() {
    try {
      await api("/api/teams/join", { method: "POST", body: { token: joinToken.trim() } });
      show("Joined team");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function submitDraft(id: string) {
    try {
      await api(`/api/submissions/${id}/submit`, { method: "POST" });
      show("Submitted before the deadline 🎉");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  const activeEvent = events[0];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Your dashboard</h1>
        <p className="mb-6 text-sm text-forge-400">Teams, submissions and deadlines — all times shown in UTC.</p>

        {state === "loading" && <Spinner label="Loading your workspace…" />}
        {state === "error" && <ErrorState message={errMsg} onRetry={() => void load()} />}

        {state === "ready" && me && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="team-h" className="card p-5">
              <h2 id="team-h" className="mb-3 font-medium">Team</h2>
              {activeEvent ? (
                <>
                  {teams.filter((t) => t.members.some((m) => m.userId === me.user.id)).length === 0 ? (
                    <div className="space-y-3">
                      <Notice tone="info">You are not on a team for {activeEvent.name} yet. Create one or join via an invite link.</Notice>
                      <div className="flex gap-2">
                        <input className="input" placeholder="Team name" aria-label="Team name" value={newTeam.name} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} />
                        <button className="btn-primary whitespace-nowrap" disabled={!newTeam.name || newTeam.name.length < 2} onClick={() => void createTeam()}>Create team</button>
                      </div>
                      <div className="flex gap-2">
                        <input className="input" placeholder="Invite token" aria-label="Invite token" value={joinToken} onChange={(e) => setJoinToken(e.target.value)} />
                        <button className="btn-secondary whitespace-nowrap" onClick={() => void join()}>Join</button>
                      </div>
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {teams.filter((t) => t.members.some((m) => m.userId === me.user.id)).map((t) => (
                        <li key={t.id} className="rounded-md border border-forge-800 p-3">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{t.name}</span>
                            <span className="badge badge-info">{t.memberCount} members</span>
                          </div>
                          <ul className="mt-2 text-sm text-forge-400">
                            {t.members.map((m) => <li key={m.userId}>{m.name} <span className="text-forge-500">({m.role.toLowerCase()})</span></li>)}
                          </ul>
                          <div className="mt-3 flex gap-2">
                            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => void makeInvite(t.id)}>Create invite link</button>
                            {!t.hasProject && <Link className="btn-primary px-3 py-1.5 text-xs" href={`/submit?teamId=${t.id}&eventId=${t.eventId}`}>Create submission</Link>}
                          </div>
                          {invite?.teamId === t.id && (
                            <div className="mt-2 rounded-md border border-ember-800 bg-ember-950/30 px-3 py-2 text-xs">
                              <div className="mb-1 font-medium text-ember-300">Share this join link:</div>
                              <code className="break-all">{`${typeof window !== "undefined" ? window.location.origin : ""}/join/${invite.token}`}</code>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <EmptyState title="No active events" hint="When an event opens, team tools appear here." />
              )}
            </section>

            <section aria-labelledby="subs-h" className="card p-5">
              <h2 id="subs-h" className="mb-3 font-medium">Your submissions</h2>
              {submissions.length === 0 ? (
                <EmptyState title="No submissions yet" hint="Create a draft from your team card, then submit before the deadline." />
              ) : (
                <ul className="space-y-3">
                  {submissions.map((s) => (
                    <li key={s.id} className="rounded-md border border-forge-800 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{s.name}</span>
                        <span className={`badge ${s.status === "DRAFT" ? "badge-warn" : s.status === "LOCKED" ? "badge-info" : s.status === "DISQUALIFIED" ? "badge-bad" : "badge-ok"}`}>
                          {s.status.toLowerCase()}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-forge-500">Team {s.team.name} · {s.track?.name ?? "no track"}</div>
                      {s.status === "DRAFT" && (
                        <div className="mt-2 flex gap-2">
                          <Link className="btn-secondary px-3 py-1.5 text-xs" href={`/submit?edit=${s.id}`}>Edit draft</Link>
                          <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => void submitDraft(s.id)}>Submit now</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {activeEvent && (
              <section aria-labelledby="deadline-h" className="card p-5 lg:col-span-2">
                <h2 id="deadline-h" className="mb-3 font-medium">Key dates — {activeEvent.name}</h2>
                <dl className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <dt className="text-forge-500">Submission deadline</dt>
                    <dd className="font-mono">{new Date(activeEvent.submissionDeadline).toISOString().replace("T", " ").slice(0, 16)} UTC</dd>
                    <dd className="mt-1 text-xs text-forge-500">After this the server locks all submitted projects.</dd>
                  </div>
                  <div>
                    <dt className="text-forge-500">Event status</dt>
                    <dd><span className="badge badge-info">{activeEvent.status.toLowerCase().replace("_", " ")}</span></dd>
                  </div>
                  <div>
                    <dt className="text-forge-500">Community voting</dt>
                    <dd>{activeEvent.votingEnabled ? <span className="badge badge-ok">open</span> : <span className="badge badge-info">disabled</span>}</dd>
                    {activeEvent.votingEnabled && activeEvent.votingEnd && (
                      <dd className="mt-1 text-xs text-forge-500">Ends {new Date(activeEvent.votingEnd).toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
                    )}
                  </div>
                </dl>
                <div className="mt-4 flex gap-2">
                  {activeEvent.votingEnabled && <Link className="btn-primary px-3 py-1.5 text-xs" href={`/vote/${activeEvent.id}`}>Open ballot</Link>}
                  <Link className="btn-secondary px-3 py-1.5 text-xs" href={`/events/${activeEvent.slug}`}>Browse gallery</Link>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
      {node}
    </>
  );
}
