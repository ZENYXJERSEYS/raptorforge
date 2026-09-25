#!/usr/bin/env node
// Local dev database helper (no Docker needed on the build machine).
// - up: start portable postgres (expects tools/pgsql + .local/pgdata, or creates them)
// - down: stop it
// - reset: stop, drop data dir, re-init, create db (dev convenience)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PG = path.join(ROOT, "tools", "pgsql", "bin");
const DATA = path.join(ROOT, ".local", "pgdata");
const LOG = path.join(ROOT, ".local", "pg.log");
const SOCK = path.join(ROOT, ".local", "pgsock");
const PORT = 54329;

function pg(tool, args) {
  execFileSync(path.join(PG, tool), args, { stdio: "inherit", shell: false });
}

function psql(sql) {
  execFileSync(path.join(PG, "psql.exe"), [
    "-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-c", sql,
  ], { stdio: "inherit" });
}

function up() {
  if (!existsSync(path.join(PG, "pg_ctl.exe"))) {
    console.error(
      "Portable PostgreSQL not found. Install Docker and use docker compose up, or place binaries at tools/pgsql (see README → Development without Docker)."
    );
    process.exit(1);
  }
  mkdirSync(SOCK, { recursive: true });
  if (!existsSync(path.join(DATA, "PG_VERSION"))) {
    mkdirSync(path.join(ROOT, ".local"), { recursive: true });
    pg("initdb", ["-D", DATA, "-U", "postgres", "-A", "trust", "-E", "UTF8"]);
  }
  try {
    execFileSync(path.join(PG, "pg_isready.exe"), ["-h", "127.0.0.1", "-p", String(PORT)], { stdio: "pipe" });
    console.log("postgres already running on", PORT);
    return;
  } catch {
    /* not running — start it */
  }
  const child = spawn(
    path.join(PG, "postgres.exe"),
    ["-D", DATA, "-p", String(PORT), "-k", SOCK, "-h", "127.0.0.1"],
    { detached: true, stdio: ["ignore", "ignore", "ignore"], shell: false }
  );
  child.unref();
  // wait for readiness
  for (let i = 0; i < 40; i++) {
    try {
      execFileSync(path.join(PG, "pg_isready.exe"), ["-h", "127.0.0.1", "-p", String(PORT)], { stdio: "pipe" });
      console.log("postgres ready on port", PORT);
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      execFileSync("sleep", ["0.25"]);
    }
  }
  console.error("postgres did not become ready in time; see .local/pg.log");
  process.exit(1);
}

function down() {
  try {
    pg("pg_ctl", ["-D", DATA, "stop", "-m", "fast"]);
    console.log("postgres stopped");
  } catch {
    console.log("postgres was not running");
  }
}

function reset() {
  down();
  rmSync(DATA, { recursive: true, force: true });
  up();
  psql('CREATE DATABASE raptorforge'); // ignore error if exists
}

const cmd = process.argv[2] || "up";
if (cmd === "up") up();
else if (cmd === "down") down();
else if (cmd === "reset") reset();
else {
  console.error("usage: node scripts/dev-db.mjs [up|down|reset]");
  process.exit(1);
}
