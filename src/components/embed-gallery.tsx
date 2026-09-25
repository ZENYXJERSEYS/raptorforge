"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

interface GalleryProject { id: string; name: string; shortDescription: string; technologies: string[]; track: { name: string } | null; team: { name: string } }

export function EmbedGallery({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [projects, setProjects] = useState<GalleryProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ projects: GalleryProject[] }>(`/api/projects?eventId=${eventId}&pageSize=24&sort=name`);
        setProjects(res.projects);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [eventId]);

  return (
    <div className="min-h-screen bg-forge-950 p-4 text-forge-100">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="inline-block h-2 w-2 rounded-sm bg-ember-500" aria-hidden />
        <span className="font-medium">{eventName}</span>
        <span className="text-forge-500">· powered by RaptorForge</span>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!error && !projects && <p className="text-sm text-forge-400">Loading…</p>}
      {projects && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id} className="rounded-md border border-forge-800 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                <span className="badge badge-info">{p.track?.name ?? "open"}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-forge-400">{p.shortDescription}</p>
              <div className="mt-1 text-[11px] text-forge-500">by {p.team.name}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
