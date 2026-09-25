"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Spinner, ErrorState, EmptyState } from "@/components/states";

interface LabData {
  methodology: {
    method: string; formula: string; minScores: number; winsorLimit: number; map: string;
    edgeCases: string[]; limitations: string;
  };
  judgeStats: { judgeId: string; judgeName: string; n: number; mean: number; sigma: number; status: string }[];
  scores: { judgeId: string; judgeName: string; projectName: string; score: number; z: number | null; normalized: number | null; note?: string }[];
  rankShifts: { count: number; rows: { project: string; rawRank: number | null; normalizedRank: number | null; changed: boolean }[] };
}

export function LabTab({ eventId }: { eventId: string }) {
  const [data, setData] = useState<LabData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await api<LabData>(`/api/events/${eventId}/normalization`);
      setData(res);
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Failed");
      setState("error");
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <Spinner />;
  if (state === "error") return <ErrorState message={errMsg} onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <section className="card p-5" aria-labelledby="meth-h">
        <h2 id="meth-h" className="mb-2 font-medium">Methodology (no black box)</h2>
        <p className="font-mono text-sm text-ember-300">{data.methodology.formula}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-forge-300">
          {data.methodology.edgeCases.map((e) => <li key={e}>{e}</li>)}
        </ul>
        <p className="mt-3 text-sm text-forge-400"><span className="font-medium text-forge-300">Limitations:</span> {data.methodology.limitations}</p>
      </section>

      <section className="card p-5" aria-labelledby="js-h">
        <h2 id="js-h" className="mb-3 font-medium">Judge scoring tendencies</h2>
        {data.judgeStats.length === 0 ? (
          <EmptyState title="No judgements yet" hint="Stats appear once judges submit weighted scores." />
        ) : (
          <table className="table-base">
            <thead><tr><th>Judge</th><th>n</th><th>Mean</th><th>σ</th><th>Status</th></tr></thead>
            <tbody>
              {data.judgeStats.map((s) => (
                <tr key={s.judgeId}>
                  <td className="font-medium">{s.judgeName}</td>
                  <td>{s.n}</td>
                  <td>{s.mean}</td>
                  <td>{s.sigma}</td>
                  <td>
                    <span className={`badge ${s.status === "normalized" ? "badge-ok" : s.status === "zero-variance" ? "badge-warn" : "badge-info"}`}>
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-5" aria-labelledby="cmp-h">
        <h2 id="cmp-h" className="mb-3 font-medium">Raw vs normalized scores</h2>
        {data.scores.length === 0 ? (
          <EmptyState title="Nothing to normalize yet" />
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="table-base">
              <thead><tr><th>Project</th><th>Judge</th><th>Raw</th><th>z</th><th>Normalized</th><th>Note</th></tr></thead>
              <tbody>
                {data.scores.map((s, i) => (
                  <tr key={`${s.judgeId}-${s.projectName}-${i}`}>
                    <td className="font-medium">{s.projectName}</td>
                    <td>{s.judgeName}</td>
                    <td className="font-mono">{s.score}</td>
                    <td className="font-mono">{s.z ?? "—"}</td>
                    <td className="font-mono">{s.normalized ?? "—"}</td>
                    <td className="text-xs text-forge-500">{s.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.rankShifts.rows.length > 0 && (
        <section className="card p-5" aria-labelledby="rk-h">
          <h2 id="rk-h" className="mb-3 font-medium">
            Raw ranking vs normalized ranking — <span className="text-ember-300">{data.rankShifts.count} position change(s)</span>
          </h2>
          <table className="table-base">
            <thead><tr><th>Project</th><th>Raw rank</th><th>Normalized rank</th><th>Changed</th></tr></thead>
            <tbody>
              {data.rankShifts.rows.map((r) => (
                <tr key={r.project}>
                  <td className="font-medium">{r.project}</td>
                  <td>{r.rawRank}</td>
                  <td>{r.normalizedRank ?? "—"}</td>
                  <td>{r.changed ? <span className="badge badge-warn">moved</span> : <span className="badge badge-info">same</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
