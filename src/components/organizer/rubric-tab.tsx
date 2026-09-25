"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Spinner, ErrorState, Notice } from "@/components/states";

interface Criterion { id: string; name: string; description: string; weight: number; minScore: number; maxScore: number; required: boolean; order: number }
interface Rubric { rubric: { id: string; name: string; version: number; criteria: Criterion[] } | null }

interface Draft {
  name: string;
  criteria: { name: string; description: string; weight: number; minScore: number; maxScore: number; required: boolean; order: number }[];
}

const DEFAULT: Draft = {
  name: "Main rubric",
  criteria: [
    { name: "Technical Quality", description: "Engineering rigor and correctness", weight: 30, minScore: 1, maxScore: 5, required: true, order: 1 },
    { name: "Innovation", description: "Novelty of idea and execution", weight: 25, minScore: 1, maxScore: 5, required: true, order: 2 },
    { name: "Impact", description: "Usefulness and reach", weight: 20, minScore: 1, maxScore: 5, required: true, order: 3 },
    { name: "User Experience", description: "Design and usability", weight: 15, minScore: 1, maxScore: 5, required: true, order: 4 },
    { name: "Completeness", description: "End-to-end working demo", weight: 10, minScore: 1, maxScore: 5, required: true, order: 5 },
  ],
};

export function RubricTab({ eventId, onChanged }: { eventId: string; onChanged?: () => void }) {
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [draft, setDraft] = useState<Draft>(DEFAULT);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const r = await api<Rubric>(`/api/events/${eventId}/rubric`);
      setRubric(r);
      if (r.rubric) {
        setDraft({
          name: r.rubric.name,
          criteria: r.rubric.criteria.map((c) => ({ name: c.name, description: c.description, weight: c.weight, minScore: c.minScore, maxScore: c.maxScore, required: c.required, order: c.order })),
        });
      }
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Failed");
      setState("error");
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const weightSum = draft.criteria.reduce((a, c) => a + Number(c.weight || 0), 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/events/${eventId}/rubric`, {
        method: "PUT",
        body: {
          name: draft.name,
          criteria: draft.criteria.map((c, i) => ({ ...c, weight: Number(c.weight), minScore: Number(c.minScore), maxScore: Number(c.maxScore), order: i + 1 })),
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

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">Judging rubric {rubric?.rubric ? `(v${rubric.rubric.version} live)` : "(none yet)"}</h2>
          <span className={`badge ${weightSum === 100 ? "badge-ok" : "badge-bad"}`}>weights: {weightSum}% / 100%</span>
        </div>
        <div className="mb-4">
          <label className="label" htmlFor="rname">Rubric name</label>
          <input id="rname" className="input max-w-md" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <ul className="space-y-3">
          {draft.criteria.map((c, i) => (
            <li key={i} className="grid gap-2 rounded-md border border-forge-800 p-3 md:grid-cols-12">
              <input className="input md:col-span-3" aria-label="Criterion name" value={c.name} onChange={(e) => { const next = [...draft.criteria]; next[i] = { ...c, name: e.target.value }; setDraft({ ...draft, criteria: next }); }} />
              <input className="input md:col-span-4" aria-label="Criterion description" placeholder="Description" value={c.description} onChange={(e) => { const next = [...draft.criteria]; next[i] = { ...c, description: e.target.value }; setDraft({ ...draft, criteria: next }); }} />
              <input className="input md:col-span-1" type="number" min={1} max={100} aria-label="Weight %" value={c.weight} onChange={(e) => { const next = [...draft.criteria]; next[i] = { ...c, weight: Number(e.target.value) }; setDraft({ ...draft, criteria: next }); }} />
              <input className="input md:col-span-1" type="number" min={0} max={100} aria-label="Min score" value={c.minScore} onChange={(e) => { const next = [...draft.criteria]; next[i] = { ...c, minScore: Number(e.target.value) }; setDraft({ ...draft, criteria: next }); }} />
              <input className="input md:col-span-1" type="number" min={1} max={100} aria-label="Max score" value={c.maxScore} onChange={(e) => { const next = [...draft.criteria]; next[i] = { ...c, maxScore: Number(e.target.value) }; setDraft({ ...draft, criteria: next }); }} />
              <label className="flex items-center gap-1 text-xs text-forge-400 md:col-span-1">
                <input type="checkbox" checked={c.required} onChange={(e) => { const next = [...draft.criteria]; next[i] = { ...c, required: e.target.checked }; setDraft({ ...draft, criteria: next }); }} /> req
              </label>
              <button
                className="btn-danger px-2 py-1 text-[11px] md:col-span-1"
                onClick={() => setDraft({ ...draft, criteria: draft.criteria.filter((_, j) => j !== i) })}
                disabled={draft.criteria.length <= 1}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <button
            className="btn-secondary"
            onClick={() => setDraft({ ...draft, criteria: [...draft.criteria, { name: "New criterion", description: "", weight: 10, minScore: 1, maxScore: 5, required: true, order: draft.criteria.length + 1 }] })}
          >
            + Add criterion
          </button>
          <button className="btn-primary" disabled={weightSum !== 100 || busy} onClick={() => void save()}>
            {busy ? "Saving…" : rubric?.rubric ? "Replace rubric" : "Create rubric"}
          </button>
        </div>
        {error && <div className="mt-3"><Notice tone="bad">{error}</Notice></div>}
        <div className="mt-3">
          <Notice tone="info">
            Weights must sum to exactly 100%. Replacing a rubric after judging starts bumps its version — already-stored
            judgements keep their original computed scores for reproducibility.
          </Notice>
        </div>
      </section>
    </div>
  );
}
