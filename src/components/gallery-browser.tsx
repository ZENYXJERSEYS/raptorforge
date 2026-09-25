"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Spinner, EmptyState, ErrorState } from "@/components/states";

interface GalleryProject {
  id: string; name: string; shortDescription: string; technologies: string[]; status: string;
  commentCount: number;
  track: { name: string; slug: string } | null;
  team: { name: string };
}
interface Page { projects: GalleryProject[]; pagination: { page: number; totalPages: number; total: number } }

export function GalleryBrowser({ eventId, tracks }: { eventId: string; tracks: { slug: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [track, setTrack] = useState("");
  const [tech, setTech] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const params = new URLSearchParams({ eventId, sort, page: String(page) });
      if (q) params.set("q", q);
      if (track) params.set("track", track);
      if (tech) params.set("tech", tech);
      const res = await api<Page>(`/api/projects?${params}`);
      setData(res);
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Failed to load gallery");
      setState("error");
    }
  }, [eventId, q, track, tech, sort, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3" role="search">
        <input
          className="input max-w-xs" placeholder="Search projects…" aria-label="Search projects"
          value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <select className="input max-w-40" aria-label="Filter by track" value={track} onChange={(e) => { setTrack(e.target.value); setPage(1); }}>
          <option value="">All tracks</option>
          {tracks.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
        </select>
        <input
          className="input max-w-40" placeholder="Tech filter…" aria-label="Filter by technology"
          value={tech} onChange={(e) => { setTech(e.target.value); setPage(1); }}
        />
        <select className="input max-w-40" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest</option>
          <option value="name">Name A→Z</option>
          <option value="team">Team A→Z</option>
        </select>
      </div>

      {state === "loading" && <Spinner label="Loading projects…" />}
      {state === "error" && <ErrorState message={errMsg} onRetry={() => void load()} />}
      {state === "ready" && data && data.projects.length === 0 && (
        <EmptyState title="No projects match" hint="Try clearing filters or a different search." />
      )}
      {state === "ready" && data && data.projects.length > 0 && (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.projects.map((p) => (
              <li key={p.id} className="card flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/projects/${p.id}`} className="font-medium hover:text-ember-300">{p.name}</Link>
                  <span className="badge badge-info shrink-0">{p.track?.name ?? "open"}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-forge-400">{p.shortDescription}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.technologies.slice(0, 5).map((t) => <span key={t} className="badge badge-info">{t}</span>)}
                </div>
                <div className="mt-auto flex items-center justify-between pt-3 text-xs text-forge-500">
                  <span>by {p.team.name}</span>
                  <span>{p.commentCount} comments</span>
                </div>
              </li>
            ))}
          </ul>
          <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
            <span className="text-xs text-forge-500">{data.pagination.total} projects</span>
            <div className="flex gap-2">
              <button className="btn-secondary px-3 py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
              <span className="px-2 py-1.5 text-xs text-forge-400">Page {data.pagination.page} / {data.pagination.totalPages}</span>
              <button className="btn-secondary px-3 py-1.5 text-xs" disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
