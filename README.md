# RaptorForge

**The open-source operating system for hackathons.**

RaptorForge is a production-quality, self-hostable hackathon submission & judging platform:
registration → teams → submissions → deterministic judge assignment → configurable weighted
rubrics → cross-judge score normalization → community voting with integrity monitoring →
results, certificates, exports and webhooks. It runs entirely on your infrastructure, fully
offline, with one command.

- **License:** MIT (see [LICENSE](./LICENSE))

---

## Quickstart

```bash
docker compose up
```

Then open **http://localhost:3000**. Migrations and seed data run automatically on boot.

### Demo accounts (password: `raptorforge`)

| Role        | Email                        |
|-------------|------------------------------|
| Organizer   | `organizer@example.local`    |
| Judge       | `judge@example.local`        |
| Participant | `participant@example.local`  |
| Admin       | `admin@example.local`        |

> These are local fixture credentials only. For any real deployment, change `APP_SECRET`,
> set `COOKIE_SECURE=true` behind TLS, and delete the seeded accounts.

The seed creates the **Dogfood 2026** event: 4 tracks, 5 prizes, 32 participants, 16 projects,
5 judges with 42 engine-generated assignments, 34 judgements with deliberately divergent judge
calibration (lenient ~91 vs harsh ~51 average) to demonstrate normalization, pairwise
comparisons, community votes including one suspicious velocity burst, comments, a demo webhook
endpoint, certificates, and a starter audit trail.

## What's inside

| Area | Highlights |
|---|---|
| Lifecycle | Registration, team formation with invite links, draft→submit workflow with server-enforced deadlines |
| Judging | Deterministic seeded assignment engine with conflict prevention + written reasons, configurable weighted rubrics (Σ=100%), immutable score-change history |
| Statistics | Cross-judge z-score normalization with winsorization, organizer Normalization Lab, Bradley–Terry pairwise mode with Davidson ties |
| Community | Public gallery with search/filter/sort/pagination, comments with moderation, configured voting with per-user randomized ballot order |
| Integrity | Rate limiting, duplicate detection, velocity heuristics (NORMAL/SUSPICIOUS/CRITICAL flags — never auto-accusations), full audit log |
| Platform | REST API with OpenAPI at `/api/openapi.json`, local PDF certificates with public verification (`/verify/:id`), embeddable gallery (`/embed/events/:slug`), CSV import/export, signed retryable webhooks, health dashboard |

## Documentation

| Doc | Contents |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, authorization model, engines, transactions, deployment |
| [DATA-MODEL.md](./DATA-MODEL.md) | Every entity and relationship, ER diagram, constraint rationale |
| [JUDGING.md](./JUDGING.md) | Assignment strategy, scoring, normalization methodology, pairwise estimation, reproducibility |
| [THREAT-MODEL.md](./THREAT-MODEL.md) | 12 threats with attack scenario / impact / likelihood / mitigation / residual risk |
| [acceptance-report.txt](./acceptance-report.txt) | Machine-generated test results for T1–T4 + bonuses |
| `openapi.yaml` / `/api/openapi.json` | Full REST API specification |

## Development

```bash
npm install          # deps + prisma client
npm run db:up        # start local PostgreSQL (Docker-free portable binaries)
npm run db:migrate   # apply schema
npm run db:seed      # load fixtures
npm run dev          # http://localhost:3000
```

### Testing

```bash
npm run test         # unit tests (engines: assignment, scoring, normalization, Bradley–Terry)
npm run verify       # db + seed + build + production server, health-checked
npm run acceptance   # full T1–T4 suite → writes acceptance-report.txt
npm run offline:check# static gate: no external URLs in runtime code
```

Integration tests exercise the real production build over HTTP against real Postgres —
including the deadline-enforcement test that proves the server clock decides submission
validity, and the hidden-results test that proves rankings cannot leak while voting is open.

### Offline operation

After `docker compose up` (or `npm run verify`), disconnect the network: every feature keeps
working. Fonts are system fonts, PDFs are generated locally by `pdf-lib`, there are no CDN
scripts, analytics, or external APIs anywhere in the runtime. `npm run offline:check` is a
static gate that fails the build if an external URL ever sneaks into shipped code.

### Development without Docker

The build machine that produced this repo had no Docker, so `scripts/dev-db.mjs` runs a
portable PostgreSQL (auto-downloaded to gitignored `tools/pgsql/`) as a normal user process on
port 54329. This is a **development convenience only** — the shipped runtime remains
`docker compose up` with PostgreSQL 16.

## API

Authentication is a session cookie (`rf_session`) set by `/api/auth/login`. Every mutating
endpoint validates input with Zod, enforces authorization server-side, and returns structured
errors:

```json
{
  "error": {
    "code": "SUBMISSION_DEADLINE_PASSED",
    "message": "The submission deadline has passed; submissions are locked."
  }
}
```

Browse all endpoints at `/docs/api` or fetch `/api/openapi.json`.

## Known limitations

- **No email** — invite links are shown in the UI rather than emailed; wire an SMTP sidecar if needed.
- **Webhooks require configuration** — offline by design; deliveries queue and retry when a receiver exists.
- **Pairwise needs volume** — Bradley–Terry is unreliable below ~3 comparisons per project; the UI flags this.
- **Single-node scaling** — the DB-backed rate limiter and session store assume one Postgres; horizontal scaling needs shared infra beyond this repo's scope.
- **Password reset** — without email, password recovery is an organizer/DB operation.
- **Certificates are hash-verified, not PKI-signed** — the verification hash proves integrity relative to `APP_SECRET`, not a public key infrastructure.
