"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { Spinner, ErrorState, Notice, useToast } from "@/components/states";

interface ImportResult { imported: number; accountsCreated?: number; accountsLinked?: number }
interface Cert { certificateId: string; participant: string; achievement: string; issuedAt: string }
interface Endpoint { id: string; url: string; events: string[]; active: boolean; recentDeliveries: { id: string; eventType: string; status: string; attempts: number; lastError: string | null }[] }
interface AuditEntry { id: string; action: string; resource: string; resourceId: string | null; metadata: Record<string, unknown>; createdAt: string; actor: { name: string; email: string } | null }

export function OpsTab({ eventId, onChanged }: { eventId: string; onChanged?: () => void }) {
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importErr, setImportErr] = useState<{ message: string; errors?: { row: number; message: string }[] } | null>(null);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState("");
  const [health, setHealth] = useState<{ status: string; checks: Record<string, string> } | null>(null);
  const [whUrl, setWhUrl] = useState("http://localhost:3999/hooks/demo");
  const fileRef = useRef<HTMLInputElement>(null);
  const { show, node } = useToast();

  const load = useCallback(async () => {
    try {
      const c = await api<{ certificates: Cert[] }>(`/api/events/${eventId}/certificates`);
      setCerts(c.certificates);
      const w = await api<{ endpoints: Endpoint[] }>(`/api/events/${eventId}/webhooks`);
      setEndpoints(w.endpoints);
      const a = await api<{ entries: AuditEntry[] }>(`/api/audit-log?pageSize=50`);
      setAudit(a.entries);
      const h = await api<{ status: string; checks: Record<string, string> }>("/api/health");
      setHealth(h);
    } catch {
      /* tab loads data opportunistically */
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function doImport(file: File, type: "participants" | "projects") {
    const text = await file.text();
    setImportErr(null);
    setImportResult(null);
    try {
      const res = await api<ImportResult>(`/api/events/${eventId}/import`, { method: "POST", body: { type, csv: text } });
      setImportResult(res);
      show(`Imported ${res.imported} rows`);
      onChanged?.();
    } catch (e) {
      const err = e as Error & { details?: { errors?: { row: number; message: string }[] } };
      setImportErr({ message: err.message, errors: err.details?.errors });
    }
  }

  async function issueCert() {
    try {
      const me = await api<{ memberships: { id: string }[] }>("/api/auth/me");
      void me;
      // issue for the first participant found in the projects export (demo convenience)
      const res = await api<{ projects: { team: string }[] }>(`/api/projects?eventId=${eventId}&pageSize=1`);
      void res;
      show("Pick a user below (demo issues for participant #1)");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function addWebhook() {
    try {
      await api(`/api/events/${eventId}/webhooks`, { method: "POST", body: { url: whUrl, events: [] } });
      show("Webhook endpoint created");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function dispatchWebhooks() {
    try {
      const res = await api<{ dispatched: { delivered: number; failed: number } }>(`/api/events/${eventId}/webhooks/dispatch`, { method: "POST" });
      show(`Delivered ${res.dispatched.delivered}, failed ${res.dispatched.failed} (retryable)`);
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function deleteEndpoint(id: string) {
    try {
      await api(`/api/events/${eventId}/webhooks?endpointId=${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  const EXPORTS = ["projects", "participants", "teams", "judges", "assignments", "scores", "normalized-scores", "votes", "results", "audit"];

  return (
    <div className="space-y-6">
      <section className="card p-5" aria-labelledby="exp-h">
        <h2 id="exp-h" className="mb-3 font-medium">CSV exports</h2>
        <div className="flex flex-wrap gap-2">
          {EXPORTS.map((what) => (
            <a key={what} className="btn-secondary px-3 py-1.5 text-xs" href={`/api/events/${eventId}/export?what=${what}`}>
              {what}.csv ↓
            </a>
          ))}
        </div>
      </section>

      <section className="card p-5" aria-labelledby="imp-h">
        <h2 id="imp-h" className="mb-3 font-medium">CSV import</h2>
        <p className="mb-3 text-xs text-forge-500">
          participants.csv: <code>email,name</code> · projects.csv: <code>team,name,track</code>. Malformed rows are rejected with row-level errors — nothing is partially written.
        </p>
        <div className="flex flex-wrap gap-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="text-sm" aria-label="CSV file" />
          <button className="btn-secondary" onClick={() => fileRef.current?.files?.[0] && void doImport(fileRef.current.files[0], "participants")}>Import participants</button>
          <button className="btn-secondary" onClick={() => fileRef.current?.files?.[0] && void doImport(fileRef.current.files[0], "projects")}>Import projects</button>
        </div>
        {importResult && <div className="mt-3"><Notice tone="ok">Imported {importResult.imported} row(s){importResult.accountsCreated != null ? ` · ${importResult.accountsCreated} accounts created, ${importResult.accountsLinked} linked` : ""}.</Notice></div>}
        {importErr && (
          <div className="mt-3">
            <Notice tone="bad">{importErr.message}</Notice>
            {importErr.errors && (
              <ul className="mt-2 list-disc pl-5 text-xs text-forge-400">
                {importErr.errors.slice(0, 10).map((e, i) => <li key={i}>row {e.row}: {e.message}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="card p-5" aria-labelledby="cert-h">
        <h2 id="cert-h" className="mb-3 font-medium">Certificates</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="input max-w-xs" defaultValue="" onChange={async (e) => {
            if (!e.target.value) return;
            try {
              const r = await api<{ certificate: { certificateId: string } }>(`/api/events/${eventId}/certificates`, { method: "POST", body: { userId: e.target.value, achievement: "PARTICIPANT" } });
              show(`Issued ${r.certificate.certificateId}`);
              await load();
            } catch (err) {
              show(err instanceof Error ? err.message : "Failed", "bad");
            }
          }} aria-label="Issue certificate for user">
            <option value="">Issue certificate for user…</option>
            <option value="participant-demo">participant@example.local</option>
          </select>
          <button className="btn-secondary" onClick={() => void issueCert()}>How do I pick a user?</button>
        </div>
        {certs.length === 0 ? (
          <p className="text-sm text-forge-500">No certificates issued yet.</p>
        ) : (
          <ul className="divide-y divide-forge-800">
            {certs.map((c) => (
              <li key={c.certificateId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><span className="font-mono text-ember-300">{c.certificateId}</span> — {c.participant} ({c.achievement.toLowerCase()})</span>
                <span className="flex gap-2 text-xs">
                  <a className="link" href={`/verify/${c.certificateId}`}>verify page</a>
                  <a className="link" href={`/api/certificates/${c.certificateId}/pdf`}>PDF ↓</a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5" aria-labelledby="wh-h">
        <h2 id="wh-h" className="mb-3 font-medium">Webhooks</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className="input max-w-md" value={whUrl} onChange={(e) => setWhUrl(e.target.value)} aria-label="Webhook URL" />
          <button className="btn-primary" onClick={() => void addWebhook()}>Add endpoint</button>
          <button className="btn-secondary" onClick={() => void dispatchWebhooks()}>Dispatch pending now</button>
        </div>
        {endpoints.length === 0 ? (
          <p className="text-sm text-forge-500">No endpoints configured.</p>
        ) : (
          <ul className="space-y-3">
            {endpoints.map((ep) => (
              <li key={ep.id} className="rounded-md border border-forge-800 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="text-sm">{ep.url}</code>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${ep.active ? "badge-ok" : "badge-bad"}`}>{ep.active ? "active" : "off"}</span>
                    <button className="btn-danger px-2 py-1 text-[11px]" onClick={() => void deleteEndpoint(ep.id)}>Delete</button>
                  </div>
                </div>
                {ep.recentDeliveries.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-forge-400">
                    {ep.recentDeliveries.map((d) => (
                      <li key={d.id}>
                        <span className={`badge ${d.status === "DELIVERED" ? "badge-ok" : d.status === "FAILED" ? "badge-bad" : "badge-warn"}`}>{d.status.toLowerCase()}</span>{" "}
                        {d.eventType} · attempt {d.attempts}{d.lastError ? ` · ${d.lastError}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3"><Notice tone="info">Deliveries are signed (HMAC-SHA256) and retried with backoff. A local test receiver ships at scripts/webhook-receiver.ts. Webhooks never block core flows.</Notice></div>
      </section>

      <section className="card p-5" aria-labelledby="aud-h">
        <h2 id="aud-h" className="mb-3 font-medium">Audit log</h2>
        <input className="input mb-3 max-w-xs" placeholder="Filter by action (e.g. VOTE_)" value={auditFilter} onChange={(e) => setAuditFilter(e.target.value)} aria-label="Filter audit actions" />
        <div className="max-h-96 overflow-auto">
          <table className="table-base">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th><th>Metadata</th></tr></thead>
            <tbody>
              {audit.filter((a) => !auditFilter || a.action.includes(auditFilter.toUpperCase())).map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{a.createdAt.slice(0, 19).replace("T", " ")}</td>
                  <td className="text-xs">{a.actor?.name ?? "system"}</td>
                  <td><span className="badge badge-info">{a.action}</span></td>
                  <td className="text-xs">{a.resource}{a.resourceId ? `:${a.resourceId.slice(0, 8)}` : ""}</td>
                  <td className="max-w-xs truncate font-mono text-[11px] text-forge-500">{JSON.stringify(a.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5" aria-labelledby="hlth-h">
        <h2 id="hlth-h" className="mb-3 font-medium">System health</h2>
        {health ? (
          <div className="flex flex-wrap gap-3 text-sm">
            {Object.entries(health.checks).map(([k, v]) => (
              <span key={k} className={`badge ${v === "HEALTHY" ? "badge-ok" : "badge-bad"}`}>{k}: {v}</span>
            ))}
          </div>
        ) : (
          <Spinner label="Checking health…" />
        )}
      </section>
      {node}
    </div>
  );
}
