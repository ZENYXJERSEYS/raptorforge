"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { Spinner, Notice } from "@/components/states";
import { SiteHeader } from "@/components/site-header";

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ team: { name: string } }>("/api/teams/join", { method: "POST", body: { token } });
        setResult({ ok: true, message: `You joined ${res.team.name}. See you at the forge!` });
      } catch (e) {
        setResult({ ok: false, message: e instanceof Error ? e.message : "This invite link is invalid." });
      } finally {
        setBusy(false);
      }
    })();
  }, [token]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Team invite</h1>
        {busy && <Spinner label="Redeeming invite…" />}
        {!busy && result && (
          <Notice tone={result.ok ? "ok" : "bad"}>
            {result.message} {!result.ok && <a className="link ml-1" href="/login">Sign in first if you have not already.</a>}
          </Notice>
        )}
      </main>
    </>
  );
}
