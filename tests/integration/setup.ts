import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests: run against the real production server + real Postgres.
 * Prereq: `npm run db:up && npm run db:seed && npm run build && npx next start`
 * (or `npm run verify` which chains all of it). Each test file creates its own
 * accounts so tests are independent of seed state.
 */
export const B = process.env.BASE_URL ?? "http://localhost:3000";

export interface Client {
  jar: Map<string, string>;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export function makeClient(): Client {
  const jar = new Map<string, string>();
  const f = async (path: string, init: RequestInit = {}) => {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${B}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
      redirect: "manual",
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return res;
  };
  return {
    jar,
    fetch: f,
    get: (p) => f(p).then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json()))),
    post: (p, body) => f(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }).then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json()))),
    patch: (p, body) => f(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }).then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json()))),
    put: (p, body) => f(p, { method: "PUT", body: body ? JSON.stringify(body) : undefined }).then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json()))),
    del: (p) => f(p, { method: "DELETE" }).then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json()))),
  };
}

export async function makeAccount(name: string, role: "PARTICIPANT" | "ORGANIZER" | "ADMIN" = "PARTICIPANT"): Promise<{ client: Client; email: string; userId: string }> {
  const client = makeClient();
  const email = `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const res = await client.post<{ user: { id: string } }>("/api/auth/register", {
    email,
    name: `Test ${name}`,
    password: "test-password-123",
  });
  // elevate role directly in DB when needed (setup-only, mirrors real admin ops)
  if (role !== "PARTICIPANT") {
    const { execSync } = await import("node:child_process");
    const url = process.env.DATABASE_URL ?? "";
    void execSync(
      `npx tsx -e "import{PrismaClient}from'@prisma/client';const p=new PrismaClient();p.user.update({where:{id:'${res.user.id}'},data:{role:'${role}'}}).then(()=>p.\\$disconnect())"`,
      { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } }
    );
  }
  return { client, email, userId: res.user.id };
}

let serverUp: boolean | null = null;
export async function serverReady(): Promise<boolean> {
  if (serverUp !== null) return serverUp;
  try {
    const res = await fetch(`${B}/api/health`);
    serverUp = res.ok;
  } catch {
    serverUp = false;
  }
  return serverUp;
}

export const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
