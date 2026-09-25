"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Spinner, ErrorState, Notice, useToast } from "@/components/states";

interface JudgeRow {
  id: string; name: string; email: string; status: string; expertise: string[];
  assigned: number; completed: number; fallingBehind: boolean;
}
interface AssignmentRow { id: string; judge: { name: string }; project: { name: string; team: string; track: string | null }; reason: string; judged: boolean }
interface GenerateResult { created: number; unassigned: { projectId: string; reason: string }[] }

export function JudgesTab({ eventId, onChanged }: { eventId: string; onChanged?: () => void }) {
  const [judges, setJudges] = useState<JudgeRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [mode, setMode] = useState<string>("RUBRIC");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [invite, setInvite] = useState({ email: "", name: "", expertise: "" });
  const [genResult, setGenResult] = useState<GenerateResult | null>(null);
  const [pairwise, setPairwise] = useState<Standings | null>(null);
  const { show, node } = useToast();

  interface Standings {
    standings: { projectId: string; project: string; score: number; rank: number; comparisons: number; minComparisonsMet: boolean }[];
    totalComparisons: number;
  }

  const load = useCallback(async () => {
    setState("loading");
    try {
      const j = await api<{ judges: JudgeRow[] }>(`/api/events/${eventId}/judges`);
      setJudges(j.judges);
      const a = await api<{ assignments: AssignmentRow[] }>(`/api/events/${eventId}/assignments`);
      setAssignments(a.assignments);
      const ev = await api<{ event: { judgingMode: string } }>(`/api/events/${eventId}`);
      setMode(ev.event.judgingMode);
      if (ev.event.judgingMode === "PAIRWISE") {
        const p = await api<Standings>(`/api/events/${eventId}/pairwise`);
        setPairwise(p);
      }
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Failed");
      setState("error");
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function addJudge() {
    try {
      await api(`/api/events/${eventId}/judges`, {
        method: "POST",
        body: { email: invite.email, name: invite.name, expertise: invite.expertise.split(",").map((s) => s.trim()).filter(Boolean) },
      });
      show("Judge invited (status INVITED)");
      setInvite({ email: "", name: "", expertise: "" });
      await load();
      onChanged?.();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function setStatus(judgeId: string, status: string) {
    try {
      await api(`/api/events/${eventId}/judges`, { method: "PATCH", body: { judgeId, status } });
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function generate() {
    try {
      const res = await api<GenerateResult>(`/api/events/${eventId}/assignments`, { method: "POST", body: { replace: true } });
      setGenResult(res);
      show(`Generated ${res.created} assignments`);
      await load();
      onChanged?.();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function toggleMode(nextMode: string) {
    try {
      await api(`/api/events/${eventId}`, { method: "PATCH", body: { judgingMode: nextMode } });
      show(`Judging mode: ${nextMode}`);
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  if (state === "loading") return <Spinner />;
  if (state === "error") return <ErrorState message={errMsg} onRetry={() => void load()} />;

  return (
    <div className="space-y-6">
      <section className="card p-5" aria-labelledby="jm-h">
        <h2 id="jm-h" className="mb-4 font-medium">Judge management</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          <input className="input max-w-56" placeholder="Judge email" aria-label="Judge email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          <input className="input max-w-44" placeholder="Name" aria-label="Judge name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
          <input className="input max-w-64" placeholder="Expertise (comma-sep)" aria-label="Judge expertise" value={invite.expertise} onChange={(e) => setInvite({ ...invite, expertise: e.target.value })} />
          <button className="btn-primary" disabled={!invite.email.includes("@") || !invite.name} onClick={() => void addJudge()}>Invite judge</button>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Judge</th><th>Status</th><th>Expertise</th><th>Progress</th><th>Actions</th></tr></thead>
            <tbody>
              {judges.map((j) => (
                <tr key={j.id}>
                  <td><div className="font-medium">{j.name}</div><div className="text-xs text-forge-500">{j.email}</div></td>
                  <td><span className={`badge ${j.status === "ACTIVE" ? "badge-ok" : j.status === "INVITED" ? "badge-warn" : "badge-bad"}`}>{j.status.toLowerCase()}</span></td>
                  <td className="text-xs">{j.expertise.join(", ") || "—"}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{j.completed}/{j.assigned}</span>
                      {j.fallingBehind && <span className="badge badge-warn">behind</span>}
                    </div>
                  </td>
                  <td>
                    {j.status === "ACTIVE"
                      ? <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => void setStatus(j.id, "DEACTIVATED")}>Deactivate</button>
                      : <button className="btn-primary px-2 py-1 text-[11px]" onClick={() => void setStatus(j.id, "ACTIVE")}>Activate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5" aria-labelledby="asg-h">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="asg-h" className="font-medium">Assignments</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-forge-500">mode:</span>
            <select className="input max-w-36" value={mode} onChange={(e) => void toggleMode(e.target.value)} aria-label="Judging mode">
              <option value="RUBRIC">Rubric</option>
              <option value="PAIRWISE">Pairwise</option>
            </select>
            <button className="btn-primary" onClick={() => void generate()}>Generate assignments</button>
          </div>
        </div>
        <Notice tone="info">
          Deterministic engine: seeded by the event's assignmentSeed, balanced workload, conflicts of interest rejected
          (judges never review their own team), track-expertise preferred. Same inputs → same output. Every assignment carries a written reason.
        </Notice>

        {genResult && genResult.unassigned.length > 0 && (
          <div className="mt-3">
            <Notice tone="warn">
              {genResult.unassigned.length} project(s) could not receive the full judge panel:
              <ul className="mt-1 list-disc pl-5 text-xs">
                {genResult.unassigned.slice(0, 5).map((u) => <li key={u.projectId}>{u.reason}</li>)}
              </ul>
            </Notice>
          </div>
        )}

        <div className="mt-4 max-h-96 overflow-auto">
          <table className="table-base">
            <thead><tr><th>Judge</th><th>Project</th><th>Reason</th><th>Scored</th></tr></thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td>{a.judge.name}</td>
                  <td>{a.project.name} <span className="text-xs text-forge-500">({a.project.team})</span></td>
                  <td className="max-w-md text-xs text-forge-400">{a.reason}</td>
                  <td>{a.judged ? <span className="badge badge-ok">yes</span> : <span className="badge badge-warn">pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {mode === "PAIRWISE" && pairwise && (
        <section className="card p-5" aria-labelledby="pw-h">
          <h2 id="pw-h" className="mb-3 font-medium">Pairwise standings (Bradley–Terry with Davidson ties)</h2>
          <ol className="divide-y divide-forge-800">
            {pairwise.standings.map((s) => (
              <li key={s.projectId} className="flex items-center justify-between py-2 text-sm">
                <span>#{s.rank} {s.project}</span>
                <span className="text-xs text-forge-500">{s.comparisons} comparisons{s.minComparisonsMet ? "" : " · below min n=3"}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {node}
    </div>
  );
}
