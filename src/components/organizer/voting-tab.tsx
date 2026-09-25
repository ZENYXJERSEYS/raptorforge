"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Spinner, ErrorState, Notice } from "@/components/states";

interface VotingCfg {
  event: { votingEnabled: boolean; votingStart: string | null; votingEnd: string | null; votesPerUser: number; votingResultsHidden: boolean; randomizedOrdering: boolean };
}
interface Integrity {
  summary: { totalVotes: number; flagCounts: Record<string, number>; note: string };
  flagged: { id: string; createdAt: string; flagLevel: string; flagReason: string | null; user: { name: string }; project: string }[];
  velocity: { user: { name: string }; votes: number; spanMinutes: number; votesPerMinute: number; level: string }[];
}

export function VotingTab({ eventId, onChanged }: { eventId: string; onChanged?: () => void }) {
  const [cfg, setCfg] = useState<VotingCfg["event"] | null>(null);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const d = await api<VotingCfg>(`/api/events/${eventId}`);
      setCfg({
        votingEnabled: d.event.votingEnabled,
        votingStart: d.event.votingStart,
        votingEnd: d.event.votingEnd,
        votesPerUser: d.event.votesPerUser,
        votingResultsHidden: d.event.votingResultsHidden,
        randomizedOrdering: d.event.randomizedOrdering,
      });
      const i = await api<Integrity>(`/api/events/${eventId}/integrity`);
      setIntegrity(i);
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Failed");
      setState("error");
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/events/${eventId}`, {
        method: "PATCH",
        body: {
          votingEnabled: cfg.votingEnabled,
          votingStart: cfg.votingStart ? new Date(cfg.votingStart).toISOString() : null,
          votingEnd: cfg.votingEnd ? new Date(cfg.votingEnd).toISOString() : null,
          votesPerUser: Number(cfg.votesPerUser),
          votingResultsHidden: cfg.votingResultsHidden,
          randomizedOrdering: cfg.randomizedOrdering,
        },
      });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <Spinner />;
  if (state === "error") return <ErrorState message={errMsg} onRetry={() => void load()} />;
  if (!cfg || !integrity) return null;

  return (
    <div className="space-y-6">
      <section className="card p-5" aria-labelledby="vcfg-h">
        <h2 id="vcfg-h" className="mb-4 font-medium">Voting configuration</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.votingEnabled} onChange={(e) => setCfg({ ...cfg, votingEnabled: e.target.checked })} />
            Voting enabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.votingResultsHidden} onChange={(e) => setCfg({ ...cfg, votingResultsHidden: e.target.checked })} />
            Hide results while open
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.randomizedOrdering} onChange={(e) => setCfg({ ...cfg, randomizedOrdering: e.target.checked })} />
            Randomize ballot order
          </label>
          <div>
            <label className="label" htmlFor="vstart">Voting starts</label>
            <input id="vstart" className="input" type="datetime-local" value={cfg.votingStart ? cfg.votingStart.slice(0, 16) : ""} onChange={(e) => setCfg({ ...cfg, votingStart: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="vend">Voting ends</label>
            <input id="vend" className="input" type="datetime-local" value={cfg.votingEnd ? cfg.votingEnd.slice(0, 16) : ""} onChange={(e) => setCfg({ ...cfg, votingEnd: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="vpu">Votes per user</label>
            <input id="vpu" className="input" type="number" min={1} max={100} value={cfg.votesPerUser} onChange={(e) => setCfg({ ...cfg, votesPerUser: Number(e.target.value) })} />
          </div>
        </div>
        <button className="btn-primary mt-4" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save voting config"}</button>
        {error && <div className="mt-3"><Notice tone="bad">{error}</Notice></div>}
      </section>

      <section className="card p-5" aria-labelledby="int-h">
        <h2 id="int-h" className="mb-1 font-medium">Integrity dashboard</h2>
        <p className="mb-4 text-xs text-forge-500">{integrity.summary.note}</p>
        <div className="mb-4 flex flex-wrap gap-3 text-sm">
          <span className="badge badge-info">total votes: {integrity.summary.totalVotes}</span>
          <span className="badge badge-ok">normal: {integrity.summary.flagCounts.NORMAL ?? 0}</span>
          <span className="badge badge-warn">suspicious: {integrity.summary.flagCounts.SUSPICIOUS ?? 0}</span>
          <span className="badge badge-bad">critical: {integrity.summary.flagCounts.CRITICAL ?? 0}</span>
        </div>

        <h3 className="mb-2 text-sm font-medium">Velocity (votes per minute, top accounts)</h3>
        {integrity.velocity.length === 0 ? (
          <p className="text-sm text-forge-500">No votes recorded yet.</p>
        ) : (
          <table className="table-base">
            <thead><tr><th>User</th><th>Votes</th><th>Span (min)</th><th>Votes/min</th><th>Level</th></tr></thead>
            <tbody>
              {integrity.velocity.map((v) => (
                <tr key={v.user.name}>
                  <td className="font-medium">{v.user.name}</td>
                  <td>{v.votes}</td>
                  <td>{v.spanMinutes}</td>
                  <td className="font-mono">{v.votesPerMinute}</td>
                  <td>
                    <span className={`badge ${v.level === "CRITICAL" ? "badge-bad" : v.level === "SUSPICIOUS" ? "badge-warn" : "badge-ok"}`}>{v.level.toLowerCase()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="mb-2 mt-6 text-sm font-medium">Flagged votes</h3>
        {integrity.flagged.length === 0 ? (
          <p className="text-sm text-forge-500">Nothing flagged.</p>
        ) : (
          <ul className="space-y-2">
            {integrity.flagged.slice(0, 15).map((f) => (
              <li key={f.id} className="rounded-md border border-forge-800 px-3 py-2 text-sm">
                <span className={`badge ${f.flagLevel === "CRITICAL" ? "badge-bad" : "badge-warn"}`}>{f.flagLevel.toLowerCase()}</span>{" "}
                <span className="font-medium">{f.user.name}</span> → {f.project}
                <div className="mt-0.5 text-xs text-forge-500">{f.flagReason}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
