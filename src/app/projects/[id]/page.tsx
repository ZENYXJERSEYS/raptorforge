"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { Spinner, EmptyState, ErrorState, Notice, useToast } from "@/components/states";
import { SiteHeader } from "@/components/site-header";

interface Detail {
  project: {
    id: string; name: string; shortDescription: string; fullDescription: string;
    repositoryUrl: string | null; demoUrl: string | null; videoUrl: string | null;
    technologies: string[]; status: string; submittedAt: string | null;
    track: { name: string } | null;
    team: { name: string; members: { id: string; name: string }[] };
    event: { id: string; name: string; slug: string };
  };
  comments: { id: string; body: string; author: string; createdAt: string; canDelete: boolean }[];
  voting: { active: boolean; resultsVisible: boolean; votes: number | null; myVote: boolean };
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [comment, setComment] = useState("");
  const { show, node } = useToast();

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await api<Detail>(`/api/projects/${id}`);
      setData(res);
      setState("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Failed to load project");
      setState("error");
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function vote() {
    try {
      await api(`/api/projects/${id}/votes`, { method: "POST" });
      show("Vote counted");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Vote failed", "bad");
    }
  }

  async function postComment() {
    try {
      await api(`/api/projects/${id}/comments`, { method: "POST", body: { body: comment } });
      setComment("");
      show("Comment posted");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  async function deleteComment(commentId: string) {
    try {
      await api(`/api/projects/${id}/comments?commentId=${commentId}`, { method: "DELETE" });
      show("Comment removed");
      await load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed", "bad");
    }
  }

  if (state === "loading") return <><SiteHeader /><main className="mx-auto max-w-4xl px-4 py-8"><Spinner /></main></>;
  if (state === "error") return <><SiteHeader /><main className="mx-auto max-w-4xl px-4 py-8"><ErrorState message={errMsg} onRetry={() => void load()} /></main></>;
  if (!data) return null;

  const p = data.project;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-4 text-sm text-forge-400" aria-label="Breadcrumb">
          <a className="link" href={`/events/${p.event.slug}`}>{p.event.name}</a> <span aria-hidden>/</span> {p.name}
        </nav>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">{p.name}</h1>
              <span className={`badge ${p.status === "LOCKED" ? "badge-info" : "badge-ok"}`}>{p.status.toLowerCase()}</span>
            </div>
            <p className="mt-1 text-forge-300">{p.shortDescription}</p>
            <div className="mt-2 text-sm text-forge-400">
              by <span className="font-medium text-forge-200">{p.team.name}</span>
              {p.track && <> · <span className="badge badge-info">{p.track.name}</span></>}
            </div>
            <div className="mt-1 text-xs text-forge-500">Team members: {p.team.members.map((m) => m.name).join(", ")}</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {data.voting.active && (
              <button className="btn-primary" onClick={() => void vote()} disabled={data.voting.myVote}>
                {data.voting.myVote ? "Voted ✓" : "Vote for this project"}
              </button>
            )}
            {data.voting.resultsVisible ? (
              <span className="text-sm text-forge-300">{data.voting.votes} community vote{data.voting.votes === 1 ? "" : "s"}</span>
            ) : (
              <span className="text-xs text-forge-500">Vote counts hidden until voting closes</span>
            )}
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {p.repositoryUrl && <a className="btn-secondary" href={p.repositoryUrl} target="_blank" rel="noreferrer noopener">Repository ↗</a>}
          {p.demoUrl && <a className="btn-secondary" href={p.demoUrl} target="_blank" rel="noreferrer noopener">Live demo ↗</a>}
          {p.videoUrl && <a className="btn-secondary" href={p.videoUrl} target="_blank" rel="noreferrer noopener">Video ↗</a>}
        </div>

        <section className="card mb-6 p-6" aria-labelledby="about-h">
          <h2 id="about-h" className="mb-2 font-medium">About the project</h2>
          <p className="whitespace-pre-wrap text-forge-300">{p.fullDescription}</p>
          <div className="mt-3 flex flex-wrap gap-1">
            {p.technologies.map((t) => <span key={t} className="badge badge-info">{t}</span>)}
          </div>
        </section>

        <section aria-labelledby="comments-h">
          <h2 id="comments-h" className="mb-3 font-medium">Comments ({data.comments.length})</h2>
          <div className="card mb-4 p-4">
            <label className="label" htmlFor="new-comment">Add a comment</label>
            <textarea id="new-comment" className="input min-h-20" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ask a question or leave feedback…" />
            <button className="btn-primary mt-2" disabled={!comment.trim()} onClick={() => void postComment()}>Post comment</button>
          </div>
          {data.comments.length === 0 ? (
            <EmptyState title="No comments yet" hint="Be the first to ask the team something." />
          ) : (
            <ul className="space-y-3">
              {data.comments.map((c) => (
                <li key={c.id} className="card p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{c.author}</span>
                    <div className="flex items-center gap-3">
                      <time className="text-xs text-forge-500" dateTime={c.createdAt}>{new Date(c.createdAt).toISOString().slice(0, 16).replace("T", " ")}</time>
                      {c.canDelete && (
                        <button className="text-xs text-red-400 hover:underline" onClick={() => void deleteComment(c.id)}>delete</button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-forge-300">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          {!data.voting.resultsVisible && <Notice tone="info">Community vote totals stay hidden until the voting window closes (integrity rule).</Notice>}
        </section>
      </main>
      {node}
    </>
  );
}
