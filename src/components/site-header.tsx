"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoutButton } from "@/components/logout-button";

interface Me {
  user: { id: string; name: string; role: string };
}

export function SiteHeader() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) setMe(await res.json());
      } catch {
        /* signed out */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const user = me?.user;

  return (
    <header className="border-b border-forge-800 bg-forge-950/90">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-ember-500" aria-hidden />
            RaptorForge
          </Link>
          <nav className="hidden items-center gap-4 text-sm text-forge-300 md:flex" aria-label="Main">
            <Link href="/" className="hover:text-forge-100">Events</Link>
            {user && <Link href="/dashboard" className="hover:text-forge-100">Dashboard</Link>}
            {user?.role === "JUDGE" && <Link href="/judge" className="hover:text-forge-100">Judging</Link>}
            {(user?.role === "ORGANIZER" || user?.role === "ADMIN") && (
              <Link href="/organizer" className="hover:text-forge-100">Organizer</Link>
            )}
            <Link href="/docs/api" className="hover:text-forge-100">API</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="text-forge-300">
                {user.name} <span className="badge badge-info ml-1">{user.role.toLowerCase()}</span>
              </span>
              <LogoutButton />
            </>
          ) : (
            loaded && (
              <>
                <Link href="/login" className="btn-secondary px-3 py-1.5">Sign in</Link>
                <Link href="/register" className="btn-primary px-3 py-1.5">Register</Link>
              </>
            )
          )}
        </div>
      </div>
    </header>
  );
}
