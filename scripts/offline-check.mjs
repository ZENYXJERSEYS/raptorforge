#!/usr/bin/env node
// Offline gate: shipped runtime code must not reference external services.
// Scans src/, prisma/, and config files for http(s) URLs; localhost, example
// hosts, and .svg/.ics data links are fine. Any real external host fails.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOW = [
  /^https?:\/\/(localhost|127\.0\.0\.1)/,
  /^https?:\/\/[^/]*\.local/, // fixture/demo hosts
  /^https?:\/\/(www\.)?w3\.org/, // SVG namespace constants
  /^https?:\/\/github\.com\/raptorforge-demo\//, // seeded fixture repos (never fetched)
  /^https?:\/\/demo\.example\.local\//,
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mjs|js|css|prisma)$/.test(name)) acc.push(p);
  }
  return acc;
}

const files = [
  ...walk("src"),
  ...walk("prisma"),
  "next.config.ts",
  "docker/entrypoint.sh",
];

const offenders = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const urls = text.match(/https?:\/\/[^\s"'`)\]]+/g) ?? [];
  for (const url of urls) {
    const clean = url.replace(/[.,;]+$/, "");
    if (ALLOW.some((re) => re.test(clean))) continue;
    offenders.push(`${file}: ${clean}`);
  }
}

if (offenders.length) {
  console.error("✗ offline check failed — external URLs in runtime code:");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("✓ offline check passed — no external service references in runtime code");
