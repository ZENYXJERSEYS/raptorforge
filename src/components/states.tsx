"use client";

import { useState, type ReactNode } from "react";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-12 text-forge-400" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-forge-600 border-t-ember-500" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="text-sm font-medium text-forge-300">{title}</div>
      {hint && <div className="max-w-md text-sm text-forge-500">{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-red-900/60 px-6 py-10 text-center">
      <div className="text-sm font-medium text-red-300">Something went wrong</div>
      <div className="mx-auto mt-1 max-w-md text-sm text-forge-400">{message}</div>
      {onRetry && (
        <button className="btn-secondary mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "bad" | "ok" }) {
  const tones = {
    info: "border-forge-700 bg-forge-800/40 text-forge-200",
    warn: "border-amber-800 bg-amber-950/40 text-amber-300",
    bad: "border-red-800 bg-red-950/40 text-red-300",
    ok: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
  } as const;
  return <div className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "bad" } | null>(null);
  const show = (msg: string, tone: "ok" | "bad" = "ok") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 4000);
  };
  const node = toast ? (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-50 rounded-md border px-4 py-2 text-sm shadow-lg ${
        toast.tone === "ok"
          ? "border-emerald-700 bg-emerald-950/90 text-emerald-200"
          : "border-red-700 bg-red-950/90 text-red-200"
      }`}
    >
      {toast.msg}
    </div>
  ) : null;
  return { show, node };
}
