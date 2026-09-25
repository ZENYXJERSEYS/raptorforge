#!/usr/bin/env node
// Ensures: portable Postgres up → schema pushed → fresh seed → production build → server healthy.
import { execSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

function run(cmd, opts = {}) {
  console.log(`▸ ${cmd}`);
  execSync(cmd, { stdio: "inherit", shell: true, ...opts });
}

async function main() {
  run("npm run db:up");
  run("npx prisma db push --skip-generate --accept-data-loss");
  run("npm run db:seed");

  console.log("▸ building production bundle");
  try {
    run("npm run build");
  } catch {
    console.log("build failed (possibly EPERM on engine dll) — retrying once");
    run("npm run build");
  }

  // stop any existing server, then start fresh
  try { execSync("npx kill-port 3000", { stdio: "pipe" }); } catch {}
  const server = spawn("npx", ["next", "start", "-p", "3000"], {
    detached: true, stdio: "ignore", shell: true,
  });
  server.unref();

  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://localhost:3000/api/health");
      if (res.ok) {
        console.log("✓ server healthy");
        process.exit(0);
      }
    } catch {}
    await sleep(1000);
  }
  console.error("✗ server did not become healthy");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
