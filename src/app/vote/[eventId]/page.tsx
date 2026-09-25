"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { Spinner, EmptyState, ErrorState, Notice, useToast } from "@/components/states";
import { SiteHeader } from "@/components/site-header";

interface Ballot {
  voting: { active: boolean; end: string | null; votesPerUser: number; used: number; remaining: number; resultsHidden: boolean; showCounts: boolean };
  projects: { id: string; name: string; shortDescription: string; technologies: string[]; votes: number | null; myVote: boolean; track: { name: string } | null; team: { name: string } }[];
}

export default function VotePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [data, setData] = useState<Ballot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const { show, node } = useToast();

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await api<Ballot>(`/api/events/${eventId}/voting`);
      setData(res);
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Voting unavailable");
      setState("error");
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function cast(projectId: string) {
    try {
      await api(`/api/projects/${projectId}/votes`, { method: "POST" });
      show("Vote counted");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Vote failed", "bad");
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Community vote</h1>
        <p className="mb-6 text-sm text-forge-400">Project order is randomized per voter (server-side) to be position-fair.</p>

        {state === "loading" && <Spinner label="Preparing your ballot…" />}
        {state === "error" && <ErrorState message={errMsg} onRetry={() => void load()} />}

        {state === "ready" && data && (
          <>
            <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="text-sm">
                <span className="text-forge-300">{data.voting.used} of {data.voting.votesPerUser} votes used</span>
                {data.voting.end && <span className="ml-3 text-xs text-forge-500">closes {new Date(data.voting.end).toISOString().slice(0, 16).replace("T", " ")} UTC</span>}
              </div>
              {data.voting.resultsHidden && <Notice tone="info">Live totals and rankings are hidden while voting is open.</Notice>}
            </div>

            {data.projects.length === 0 ? (
              <EmptyState title="Nothing to vote on" hint="No submitted projects yet." />
            ) : (
              <ul className="space-y-3">
                {data.projects.map((p) => (
                  <li key={p.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-forge-500">{p.team.name}{p.track ? ` · ${p.track.name}` : ""}</span>
                      <p className="mt-0.5 line-clamp-1 text-sm text-forge-400">{p.shortDescription}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {p.votes != null && <span className="text-xs text-forge-400">{p.votes} votes</span>}
                      <button
                        className={p.myVote ? "btn-secondary" : "btn-primary"}
                        disabled={p.myVote || data.voting.remaining === 0}
                        onClick={() => void cast(p.id)}
                      >
                        {p.myVote ? "Voted ✓" : data.voting.remaining === 0 ? "Quota reached" : "Vote"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
      {node}
    </>
  );
}
