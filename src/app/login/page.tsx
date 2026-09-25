"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  const demos = [
    ["organizer@example.local", "organizer"],
    ["judge@example.local", "judge"],
    ["participant@example.local", "participant"],
    ["admin@example.local", "admin"],
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sign in to RaptorForge</h1>
      <p className="mb-6 text-sm text-forge-400">Welcome back to the forge.</p>
      <form onSubmit={submit} className="card space-y-4 p-6" aria-labelledby="login-form">
        <h2 id="login-form" className="sr-only">Login form</h2>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300" role="alert">{error}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="text-center text-sm text-forge-400">
          No account? <Link href="/register" className="link">Register</Link>
        </p>
      </form>

      <div className="card mt-4 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-forge-400">Demo accounts (password: raptorforge)</div>
        <ul className="grid grid-cols-2 gap-2 text-xs">
          {demos.map(([em, label]) => (
            <li key={em}>
              <button
                className="btn-secondary w-full justify-start px-2 py-1.5 text-left"
                onClick={() => { setEmail(em); setPassword("raptorforge"); }}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
