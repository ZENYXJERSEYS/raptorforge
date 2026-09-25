"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Spinner, ErrorState, Notice, useToast } from "@/components/states";

interface EventDetail {
  event: {
    id: string; name: string; status: string; judgingMode: string;
    startDate: string; endDate: string; registrationStart: string; registrationEnd: string;
    submissionDeadline: string; judgesPerProject: number; assignmentSeed: number; maxTeamSize: number;
    projectCount: number; teamCount: number;
  };
}
interface ProjectRow { id: string; name: string; status: string; team: { name: string }; track: { name: string } | null }

const STATUSES = ["DRAFT", "REGISTRATION_OPEN", "ACTIVE", "SUBMISSIONS_CLOSED", "JUDGING", "VOTING", "COMPLETED", "ARCHIVED"];

export function OverviewTab({ eventId }: { eventId: string }) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const { show, node } = useToast();

  const load = useCallback(async () => {
    setState("loading");
    try {
      const d = await api<EventDetail>(`/api/events/${eventId}`);
      setDetail(d);
      const g = await api<{ projects: ProjectRow[] }>(`/api/projects?eventId=${eventId}&pageSize=50`);
      setProjects(g.projects);
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Failed");
      setState("error");
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function saveDates() {
    try {
      const body: Record<string, string | number> = {};
      for (const k of ["startDate", "endDate", "registrationStart", "registrationEnd", "submissionDeadline"]) {
        if (edit[k]) body[k] = new Date(edit[k]).toISOString();
      }
      if (edit.status) body.status = edit.status;
      if (edit.judgesPerProject) body.judgesPerProject = Number(edit.judgesPerProject);
      if (edit.maxTeamSize) body.maxTeamSize = Number(edit.maxTeamSize);
      await api(`/api/events/${eventId}`, { method: "PATCH", body });
      show("Event updated");
      setEdit({});
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function moderate(projectId: string, action: string) {
    try {
      await api(`/api/projects/${projectId}/moderate`, { method: "POST", body: { action } });
      show("Submission updated");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  if (state === "loading") return <Spinner />;
  if (state === "error") return <ErrorState message={errMsg} onRetry={() => void load()} />;
  if (!detail) return null;
  const ev = detail.event;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Status", ev.status.toLowerCase().replace("_", " ")],
          ["Projects", String(ev.projectCount)],
          ["Teams", String(ev.teamCount)],
          ["Judging mode", ev.judgingMode],
        ].map(([k, v]) => (
          <div key={k} className="card p-4">
            <div className="text-xs uppercase tracking-wide text-forge-500">{k}</div>
            <div className="mt-1 font-medium">{v}</div>
          </div>
        ))}
      </div>

      <section className="card p-5" aria-labelledby="cfg-h">
        <h2 id="cfg-h" className="mb-4 font-medium">Event configuration</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["startDate", "Start date"],
            ["endDate", "End date"],
            ["registrationStart", "Registration opens"],
            ["registrationEnd", "Registration closes"],
            ["submissionDeadline", "Submission deadline"],
          ].map(([k, label]) => (
            <div key={k}>
              <label className="label" htmlFor={`f-${k}`}>{label}</label>
              <input
                id={`f-${k}`} className="input" type="date"
                defaultValue={edit[k] ?? (ev as unknown as Record<string, string>)[k]?.slice(0, 10)}
                onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
              />
            </div>
          ))}
          <div>
            <label className="label" htmlFor="f-status">Status</label>
            <select id="f-status" className="input" defaultValue={ev.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-jpp">Judges per project</label>
            <input id="f-jpp" className="input" type="number" min={1} max={20} defaultValue={ev.judgesPerProject} onChange={(e) => setEdit({ ...edit, judgesPerProject: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="f-mts">Max team size</label>
            <input id="f-mts" className="input" type="number" min={1} max={10} defaultValue={ev.maxTeamSize} onChange={(e) => setEdit({ ...edit, maxTeamSize: e.target.value })} />
          </div>
        </div>
        <button className="btn-primary mt-4" onClick={() => void saveDates()}>Save configuration</button>
        <div className="mt-2"><Notice tone="info">Deadline changes take effect immediately — enforcement is always server-side.</Notice></div>
      </section>

      <section className="card p-5" aria-labelledby="mod-h">
        <h2 id="mod-h" className="mb-4 font-medium">Submissions</h2>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Project</th><th>Team</th><th>Track</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.team.name}</td>
                  <td>{p.track?.name ?? "—"}</td>
                  <td><span className={`badge ${p.status === "LOCKED" ? "badge-info" : p.status === "DISQUALIFIED" ? "badge-bad" : "badge-ok"}`}>{p.status.toLowerCase()}</span></td>
                  <td>
                    <div className="flex gap-1">
                      {p.status === "SUBMITTED" && <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => void moderate(p.id, "LOCK")}>Lock</button>}
                      {p.status === "LOCKED" && <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => void moderate(p.id, "UNLOCK")}>Unlock</button>}
                      {p.status !== "DISQUALIFIED" && <button className="btn-danger px-2 py-1 text-[11px]" onClick={() => void moderate(p.id, "DISQUALIFY")}>DQ</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {node}
    </div>
  );
}
