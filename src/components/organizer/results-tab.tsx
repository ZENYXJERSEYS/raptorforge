"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Spinner, ErrorState, Notice, useToast } from "@/components/states";

interface Results {
  mode: string;
  projects: {
    projectId: string; name: string; teamName: string; trackName: string | null; n: number;
    rawMean: number | null; normalizedMean: number | null;
    rawRank: number | null; normalizedRank: number | null;
    pairwiseScore: number | null; pairwiseRank: number | null;
    prizeIds: string[];
  }[];
  normalization: { stats: unknown[]; rankShifts: number } | null;
  prizeAssignments: { prizeId: string; prizeName: string; projectId: string | null }[];
  pairwise: { nu: number; iterations: number; isolated: string[] } | null;
}

export function ResultsTab({ eventId, onChanged }: { eventId: string; onChanged?: () => void }) {
  const [results, setResults] = useState<Results | null>(null);
  const [published, setPublished] = useState<boolean | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const { show, node } = useToast();

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await api<{ results: Results; published: boolean }>(`/api/events/${eventId}/results`);
      setResults(res.results);
      setPublished(res.published);
      setState("ready");
    } catch (e) {
      // 404 simply means not generated yet
      setResults(null);
      setPublished(null);
      setState("ready");
      void e;
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function act(action: "generate" | "publish" | "unpublish") {
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/results`, { method: "POST", body: { action } });
      show(action === "generate" ? "Results generated (reproducible)" : action === "publish" ? "Results published" : "Results unpublished");
      await load();
      onChanged?.();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <Spinner />;
  if (state === "error") return <ErrorState message={errMsg} onRetry={() => void load()} />;

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Results engine</h2>
            <p className="text-xs text-forge-500">Computed from stored scores only — never hardcoded. Every run is persisted for reproducibility.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => void act("generate")}>{busy ? "Working…" : "Generate results"}</button>
            <button className="btn-secondary" disabled={busy || published == null} onClick={() => void act(published ? "unpublish" : "publish")}>
              {published ? "Unpublish" : "Publish"}
            </button>
            <a className="btn-secondary" href={`/api/events/${eventId}/export?what=results`}>Export CSV</a>
          </div>
        </div>
        {published != null && (
          <div className="mb-4"><Notice tone={published ? "ok" : "info"}>{published ? "Results are published — visible on the public results view." : "Results are hidden from the public."}</Notice></div>
        )}

        {!results ? (
          <Notice tone="info">No results generated yet. Click “Generate results”.</Notice>
        ) : (
          <>
            {results.pairwise && (
              <div className="mb-4"><Notice tone="info">Pairwise mode · ν={results.pairwise.nu} · MM iterations: {results.pairwise.iterations}{results.pairwise.isolated.length ? ` · isolated projects: ${results.pairwise.isolated.length}` : ""}</Notice></div>
            )}
            {results.normalization && (
              <div className="mb-4"><Notice tone="info">{results.normalization.rankShifts} project(s) changed position after cross-judge normalization.</Notice></div>
            )}
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>#</th><th>Project</th><th>Team</th><th>Track</th><th>n</th>
                    {results.mode === "RUBRIC" ? <><th>Raw mean</th><th>Normalized</th><th>Raw rank</th><th>Norm rank</th></> : <><th>BT score</th><th>BT rank</th></>}
                    <th>Prizes</th>
                  </tr>
                </thead>
                <tbody>
                  {[...results.projects]
                    .sort((a, b) => (results.mode === "RUBRIC" ? (a.rawRank ?? 999) - (b.rawRank ?? 999) : (a.pairwiseRank ?? 999) - (b.pairwiseRank ?? 999)))
                    .map((p) => (
                      <tr key={p.projectId}>
                        <td className="font-mono">{results.mode === "RUBRIC" ? p.rawRank : p.pairwiseRank}</td>
                        <td className="font-medium">{p.name}</td>
                        <td>{p.teamName}</td>
                        <td>{p.trackName ?? "—"}</td>
                        <td>{p.n}</td>
                        {results.mode === "RUBRIC" ? (
                          <>
                            <td className="font-mono">{p.rawMean ?? "—"}</td>
                            <td className="font-mono">{p.normalizedMean ?? "—"}</td>
                            <td>{p.rawRank}</td>
                            <td>{p.normalizedRank ?? "—"}</td>
                          </>
                        ) : (
                          <>
                            <td className="font-mono">{p.pairwiseScore ?? "—"}</td>
                            <td>{p.pairwiseRank ?? "—"}</td>
                          </>
                        )}
                        <td>
                          {results.prizeAssignments.filter((a) => a.projectId === p.projectId).map((a) => (
                            <span key={a.prizeId} className="badge badge-ok mr-1">{a.prizeName}</span>
                          ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {node}
    </div>
  );
}
