"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";

interface Op { summary?: string; tags?: string[] }
interface Spec { info: { title: string; version: string; description: string }; paths: Record<string, Record<string, Op>> }

export default function ApiDocsPage() {
  const [spec, setSpec] = useState<Spec | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/openapi.json");
      setSpec(await res.json());
    })();
  }, []);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{spec?.info.title ?? "API"} documentation</h1>
        <p className="mb-6 text-sm text-forge-400">{spec?.info.description}</p>
        <div className="mb-6">
          <a className="btn-secondary" href="/api/openapi.json" download>Download openapi.json</a>
        </div>
        {!spec ? (
          <p className="text-forge-400">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {Object.entries(spec.paths).map(([path, ops]) => (
              <li key={path} className="card p-4">
                <code className="text-sm text-ember-300">{path}</code>
                <ul className="mt-2 space-y-1">
                  {Object.entries(ops).map(([method, op]) => (
                    <li key={method} className="text-sm">
                      <span className="badge badge-info mr-2 uppercase">{method}</span>
                      {op.summary ?? ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
