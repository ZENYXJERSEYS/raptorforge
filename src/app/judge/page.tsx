"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Spinner, EmptyState, ErrorState, Notice, useToast } from "@/components/states";
import { SiteHeader } from "@/components/site-header";

interface QueueItem {
  assignmentId: string;
  project: {
    id: string; name: string; shortDescription: string; fullDescription: string;
    team: string; track: string | null; technologies: string[];
    repositoryUrl: string | null; demoUrl: string | null; videoUrl: string | null;
  };
  judged: boolean;
  myWeightedScore: number | null;
}
interface Queue { queue: QueueItem[]; progress: { assigned: number; completed: number; remaining: number; percent: number } }
interface Criterion { id: string; name: string; description: string; weight: number; minScore: number; maxScore: number }
interface Rubric { rubric: { id: string; name: string; criteria: Criterion[] } | null }
interface Standings { standings: { projectId: string; project: string; score: number; rank: number; comparisons: number; minComparisonsMet: boolean }[]; projects: { id: string; name: string; team: { name: string } }[]; mine: { projectA: string; projectB: string; winner: string }[] }

export default function JudgePage() {
  const [events, setEvents] = useState<{ id: string; name: string; judgingMode: string }[]>([]);
  const [eventId, setEventId] = useState<string>("");
  const [mode, setMode] = useState<string>("RUBRIC");
  const [queue, setQueue] = useState<Queue | null>(null);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [pairwise, setPairwise] = useState<Standings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [active, setActive] = useState<QueueItem | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const { show, node } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ judgeProfiles: { id: string; eventId: string; status: string }[] }>("/api/auth/me");
        const evs: { id: string; name: string; judgingMode: string }[] = [];
        for (const jp of me.judgeProfiles.filter((j) => j.status === "ACTIVE")) {
          const ev = await api<{ event: { id: string; name: string; judgingMode: string } }>(`/api/events/${jp.eventId}`);
          evs.push(ev.event);
        }
        setEvents(evs);
        if (evs[0]) {
          setEventId(evs[0].id);
          setMode(evs[0].judgingMode);
        } else {
          setState("ready");
        }
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : "Failed to load");
        setState("error");
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!eventId) return;
    setState("loading");
    try {
      if (mode === "RUBRIC") {
        const q = await api<Queue>(`/api/events/${eventId}/judge-queue`);
        setQueue(q);
        const r = await api<Rubric>(`/api/events/${eventId}/rubric`);
        setRubric(r);
      } else {
        const p = await api<Standings>(`/api/events/${eventId}/pairwise`);
        setPairwise(p);
      }
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Failed to load queue");
      setState("error");
    }
  }, [eventId, mode]);

  useEffect(() => { void load(); }, [load]);

  function open(item: QueueItem) {
    setActive(item);
    setScores({});
    setComment("");
    if (rubric?.rubric) {
      const init: Record<string, number> = {};
      for (const c of rubric.rubric.criteria) init[c.id] = c.minScore;
      setScores(init);
    }
  }

  async function submitJudgement() {
    if (!active || !rubric?.rubric) return;
    try {
      await api(`/api/events/${eventId}/judgements`, {
        method: "POST",
        body: {
          projectId: active.project.id,
          comment,
          scores: Object.entries(scores).map(([criterionId, value]) => ({ criterionId, value })),
        },
      });
      show("Judgement recorded");
      setActive(null);
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function recordComparison(a: string, b: string, winner: "A" | "B" | "TIE") {
    try {
      await api(`/api/events/${eventId}/pairwise`, { method: "POST", body: { projectA: a, projectB: b, winner } });
      show("Comparison recorded");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Judging</h1>
        <p className="mb-6 text-sm text-forge-400">You only ever see projects assigned to you. Other judges' scores stay private.</p>

        {events.length === 0 && state === "ready" && (
          <EmptyState title="No judging assignments" hint="You have no active judge profile yet. Organizers invite judges per event." />
        )}
        {events.length > 1 && (
          <div className="mb-4 flex gap-2">
            {events.map((e) => (
              <button key={e.id} className={e.id === eventId ? "btn-primary px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"} onClick={() => { setEventId(e.id); setMode(e.judgingMode); }}>
                {e.name}
              </button>
            ))}
          </div>
        )}

        {state === "loading" && <Spinner label="Loading your queue…" />}
        {state === "error" && <ErrorState message={errMsg} onRetry={() => void load()} />}

        {state === "ready" && mode === "RUBRIC" && queue && (
          <>
            <div className="card mb-6 p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">Progress</span>
                <span className="text-forge-400">{queue.progress.completed}/{queue.progress.assigned} reviewed · {queue.progress.remaining} remaining</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-forge-800" role="progressbar" aria-valuenow={queue.progress.percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-ember-500 transition-all" style={{ width: `${queue.progress.percent}%` }} />
              </div>
            </div>

            {active ? (
              <div className="card mb-6 p-6">
                <button className="btn-secondary mb-4 px-3 py-1.5 text-xs" onClick={() => setActive(null)}>← Back to queue</button>
                <h2 className="text-xl font-semibold">{active.project.name}</h2>
                <p className="mt-1 text-sm text-forge-400">{active.project.team}{active.project.track ? ` · ${active.project.track}` : ""}</p>
                <p className="mt-3 whitespace-pre-wrap text-sm text-forge-300">{active.project.fullDescription}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {active.project.technologies.map((t) => <span key={t} className="badge badge-info">{t}</span>)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  {active.project.repositoryUrl && <a className="link" href={active.project.repositoryUrl} target="_blank" rel="noreferrer noopener">Repository ↗</a>}
                  {active.project.demoUrl && <a className="link" href={active.project.demoUrl} target="_blank" rel="noreferrer noopener">Demo ↗</a>}
                  {active.project.videoUrl && <a className="link" href={active.project.videoUrl} target="_blank" rel="noreferrer noopener">Video ↗</a>}
                </div>

                <hr className="my-5 border-forge-800" />

                {rubric?.rubric ? (
                  <form onSubmit={(e) => { e.preventDefault(); void submitJudgement(); }}>
                    <fieldset>
                      <legend className="mb-3 text-sm font-medium">Score each criterion ({rubric.rubric.name})</legend>
                      {rubric.rubric.criteria.map((c) => (
                        <div key={c.id} className="mb-4">
                          <div className="mb-1 flex items-baseline justify-between">
                            <label className="text-sm font-medium" htmlFor={`c-${c.id}`}>{c.name} <span className="ml-1 text-xs text-forge-500">weight {c.weight}%</span></label>
                            <span className="text-xs text-forge-500">{c.description}</span>
                          </div>
                          <div className="flex gap-1" role="radiogroup" aria-label={c.name}>
                            {Array.from({ length: c.maxScore - c.minScore + 1 }, (_, i) => c.minScore + i).map((v) => (
                              <button
                                key={v} type="button" role="radio" aria-checked={scores[c.id] === v}
                                className={`h-9 w-9 rounded-md border text-sm ${scores[c.id] === v ? "border-ember-500 bg-ember-600/30 text-ember-300" : "border-forge-700 text-forge-300 hover:border-forge-500"}`}
                                onClick={() => setScores({ ...scores, [c.id]: v })}
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </fieldset>
                    <div className="mb-4">
                      <label className="label" htmlFor="jcomment">Comments (optional)</label>
                      <textarea id="jcomment" className="input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} />
                    </div>
                    <button className="btn-primary" type="submit">Submit judgement</button>
                  </form>
                ) : (
                  <Notice tone="warn">No rubric configured yet — organizers must publish one before judging.</Notice>
                )}
              </div>
            ) : (
              <ul className="space-y-3">
                {queue.queue.length === 0 && (
                  <EmptyState title="No assigned projects" hint="Assignments are generated by the organizer with the deterministic engine." />
                )}
                {queue.queue.map((item) => (
                  <li key={item.assignmentId} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <span className="font-medium">{item.project.name}</span>
                      <span className="ml-2 text-xs text-forge-500">{item.project.team}{item.project.track ? ` · ${item.project.track}` : ""}</span>
                      <p className="line-clamp-1 text-sm text-forge-400">{item.project.shortDescription}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.judged && <span className="badge badge-ok">scored {item.myWeightedScore}</span>}
                      <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => open(item)}>
                        {item.judged ? "Revise" : "Judge"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {state === "ready" && mode === "PAIRWISE" && pairwise && (
          <>
            <Notice tone="info">This event uses pairwise judging: pick the better of two projects (or a tie). Rankings come from a Bradley–Terry model.</Notice>
            <h2 className="mb-3 mt-6 font-medium">Record a comparison</h2>
            {pairwise.projects.length < 2 ? (
              <EmptyState title="Not enough projects" hint="Pairwise needs at least two submitted projects." />
            ) : (
              <div className="card mb-8 grid gap-3 p-4 md:grid-cols-2">
                {[pairwise.projects[0], pairwise.projects[1]].map((p, idx) => (
                  <div key={p.id} className="rounded-md border border-forge-800 p-4">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-forge-500">{p.team.name}</div>
                    <div className="mt-3 flex gap-2">
                      <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => void recordComparison(pairwise.projects[0].id, pairwise.projects[1].id, idx === 0 ? "A" : "B")}>Prefer this</button>
                    </div>
                  </div>
                ))}
                <button className="btn-secondary md:col-span-2" onClick={() => void recordComparison(pairwise.projects[0].id, pairwise.projects[1].id, "TIE")}>Call it a tie</button>
              </div>
            )}
            <h2 className="mb-3 font-medium">Current standings (organizer-visible too)</h2>
            <ol className="card divide-y divide-forge-800 p-0">
              {pairwise.standings.map((s) => (
                <li key={s.projectId} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>#{s.rank} {s.project}</span>
                  <span className="text-xs text-forge-500">{s.comparisons} comparisons{s.minComparisonsMet ? "" : " · below minimum n=3"}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </main>
      {node}
    </>
  );
}
