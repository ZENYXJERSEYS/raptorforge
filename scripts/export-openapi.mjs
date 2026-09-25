#!/usr/bin/env node
// Exports the live OpenAPI document to openapi.yaml (root) for repo browsing.
// The canonical, always-current spec is served at /api/openapi.json.
import { writeFileSync } from "node:fs";
import yaml from "js-yaml";

const B = process.env.BASE_URL ?? "http://localhost:3000";
const res = await fetch(`${B}/api/openapi.json`);
if (!res.ok) {
  console.error(`could not fetch spec from ${B} (is the server running? npm run verify)`);
  process.exit(1);
}
const spec = await res.json();
writeFileSync("openapi.yaml", yaml.dump(spec, { lineWidth: 100 }));
console.log("openapi.yaml written from the live spec");
