"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { Spinner, Notice, useToast } from "@/components/states";
import { SiteHeader } from "@/components/site-header";

interface Track { id: string; name: string }
interface ProjectDto {
  id: string; name: string; shortDescription: string; fullDescription: string;
  trackId: string | null; repositoryUrl: string | null; demoUrl: string | null; videoUrl: string | null;
  technologies: string[]; status: string;
}

function SubmitInner() {
  const params = useSearchParams();
  const router = useRouter();
  const editId = params.get("edit");
  const teamId = params.get("teamId");
  const eventId = params.get("eventId") ?? "";

  const [tracks, setTracks] = useState<Track[]>([]);
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [form, setForm] = useState({
    name: "", trackId: "", shortDescription: "", fullDescription: "",
    repositoryUrl: "", demoUrl: "", videoUrl: "", technologies: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { show, node } = useToast();

  useEffect(() => {
    (async () => {
      try {
        if (eventId) {
          const t = await api<{ tracks: Track[] }>(`/api/events/${eventId}/tracks`);
          setTracks(t.tracks);
        }
        if (editId) {
          const p = await api<{ project: ProjectDto }>(`/api/submissions/${editId}`);
          setProject(p.project);
          setForm({
            name: p.project.name,
            trackId: p.project.trackId ?? "",
            shortDescription: p.project.shortDescription,
            fullDescription: p.project.fullDescription,
            repositoryUrl: p.project.repositoryUrl ?? "",
            demoUrl: p.project.demoUrl ?? "",
            videoUrl: p.project.videoUrl ?? "",
            technologies: p.project.technologies.join(", "),
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [editId, eventId]);

  async function save(submitAfter: boolean) {
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name,
      trackId: form.trackId || null,
      shortDescription: form.shortDescription,
      fullDescription: form.fullDescription,
      repositoryUrl: form.repositoryUrl || null,
      demoUrl: form.demoUrl || null,
      videoUrl: form.videoUrl || null,
      technologies: form.technologies.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    };
    try {
      if (editId) {
        await api(`/api/submissions/${editId}`, { method: "PATCH", body: payload });
        if (submitAfter) {
          await api(`/api/submissions/${editId}/submit`, { method: "POST" });
          show("Submitted!");
          router.push("/dashboard");
          router.refresh();
          return;
        }
        show("Draft saved");
      } else {
        const res = await api<{ project: { id: string } }>("/api/submissions", { method: "POST", body: { ...payload, eventId, teamId } });
        if (submitAfter) {
          await api(`/api/submissions/${res.project.id}/submit`, { method: "POST" });
          show("Submitted!");
          router.push("/dashboard");
          return;
        }
        show("Draft created");
        router.push(`/submit?edit=${res.project.id}`);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          {editId ? "Edit submission" : "New submission"}
        </h1>
        <p className="mb-6 text-sm text-forge-400">
          Draft freely — only “Submit” is checked against the event deadline, and submitted work is locked.
        </p>
        <form className="card space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
          <div>
            <label className="label" htmlFor="name">Project name *</label>
            <input id="name" className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="track">Track *</label>
            <select id="track" className="input" required value={form.trackId} onChange={(e) => setForm({ ...form, trackId: e.target.value })}>
              <option value="">Select a track…</option>
              {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="short">Short description * (max 280)</label>
            <input id="short" className="input" maxLength={280} required value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="full">Full description *</label>
            <textarea id="full" className="input min-h-32" required value={form.fullDescription} onChange={(e) => setForm({ ...form, fullDescription: e.target.value })} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="label" htmlFor="repo">Repository URL</label>
              <input id="repo" className="input" type="url" placeholder="https://git.example.local/your/repo" value={form.repositoryUrl} onChange={(e) => setForm({ ...form, repositoryUrl: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="demo">Demo URL</label>
              <input id="demo" className="input" type="url" placeholder="https://demo.example.local" value={form.demoUrl} onChange={(e) => setForm({ ...form, demoUrl: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="video">Video URL</label>
              <input id="video" className="input" type="url" placeholder="https://video.example.local" value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="tech">Technologies (comma-separated)</label>
            <input id="tech" className="input" placeholder="react, postgres, esp32" value={form.technologies} onChange={(e) => setForm({ ...form, technologies: e.target.value })} />
          </div>

          {error && <Notice tone="bad">{error}</Notice>}

          <div className="flex flex-wrap gap-3 border-t border-forge-800 pt-4">
            <button type="submit" className="btn-secondary" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void save(true)}>
              {busy ? "Working…" : "Submit for judging"}
            </button>
          </div>
        </form>
      </main>
      {node}
    </>
  );
}

export default function SubmitPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SubmitInner />
    </Suspense>
  );
}
