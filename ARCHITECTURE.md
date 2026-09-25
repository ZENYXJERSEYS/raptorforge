# Architecture

RaptorForge is a single Next.js (App Router) application with clean server-side service
boundaries, backed by PostgreSQL through Prisma. One process serves the UI and the REST API,
which keeps the offline `docker compose up` story simple while preserving a real API-first
design: every UI action calls a documented endpoint.

```
┌────────────────────────────────────────────────┐
│ Next.js app (React 19 + Tailwind)              │
│   pages: public gallery, dashboards, console   │
├────────────────────────────────────────────────┤
│ API routes (src/app/api/**)                    │
│   handler() wrapper: zod + errors + cookies    │
├────────────────────────────────────────────────┤
│ Services (src/server/**)                       │
│   rbac · session · audit · ratelimit           │
│   judging/{assignment,scoring,normalization,   │
│           bradleyterry}                        │
│   results · voting · webhooks · certificates   │
├────────────────────────────────────────────────┤
│ Prisma → PostgreSQL 16                         │
└────────────────────────────────────────────────┘
```

## Frontend

- **React Server Components** render data-heavy shells (landing, event pages, embed).
- **Client components** own interactive screens: participant dashboard, judge portal,
  organizer console (tabbed: overview / judges / rubric / lab / voting / results / ops).
- Shared design system in `globals.css` — dark "forge" palette, ember accent, dense
  organizer tables, focus-visible rings, semantic landmarks. No component library lock-in.
- Every list screen has explicit loading (`Spinner`), empty (`EmptyState`), error
  (`ErrorState` with retry), and success (toast) states.
- The client `api()` helper unwraps the structured error envelope so users see real
  backend messages ("The submission deadline has passed…"), never stack traces.

## Backend & authorization

Authorization is centralized in `src/server/auth/rbac.ts`; routes never improvise checks:

| Guard | Meaning |
|---|---|
| `requireAuth` | valid session → user |
| `requireRole` | global role in allowlist (ORGANIZER/ADMIN/…) |
| `requireEventOrganizer` | global role **or** EventOrganizer row for that event |
| `requireTeamMember` | TeamMember row for that team |
| `requireJudge` | ACTIVE Judge row for that event |

Resource ownership is always resolved server-side (e.g. submission edits verify team
membership of the *project's* team, not of any client-supplied id). Deadlines are enforced by
`enforceSubmissionDeadline` using the server clock only — there is no code path where client
time influences submission state. See THREAT-MODEL.md for the abuse cases this closes.

## Engines (all pure, deterministic, unit-tested)

- **Assignment** (`judging/assignment.ts`) — seeded Fisher–Yates project order, greedy
  least-loaded judge selection with track-expertise affinity and structural conflict
  rejection (a judge can never be assigned to their own team). Same inputs + seed ⇒ same
  output; every decision carries a human-readable reason for the audit view.
- **Scoring** (`judging/scoring.ts`) — weighted score = Σ((value−min)/(max−min))×weight,
  computed only on the server; raw criterion values and the computed weighted score are both
  persisted for reproducibility.
- **Normalization** (`judging/normalization.ts`) — per-judge z-scores with documented edge
  handling (min-5-scores, zero-variance fallback, ±2.5 winsorization, fixed 50+10z map).
  Methodology in JUDGING.md; the organizer lab renders the exact numbers.
- **Bradley–Terry + Davidson ties** (`judging/bradleyterry.ts`) — MM iteration, monotone and
  deterministic; connectivity/isolation is reported rather than hidden.
- **Results** (`results.ts`) — raw/normalized/pairwise rankings plus prize assignment from a
  single ranked list per prize scope; every run is persisted (`EventResult`,
  `NormalizationRun`) so any published ranking can be re-derived from stored scores.

## Transactions

Critical multi-step mutations run inside `prisma.$transaction`:

- **Submission submit** — status transition + audit in one tx; deadline checked before it.
- **Assignment generation** — delete-old + create-new + audit atomically, so a partially
  generated assignment set can never be observed.
- **Judgement** — upsert scores + append immutable `ScoreChange` rows + audit in one tx;
  score history can never diverge from the current value.
- **Vote casting** — vote + `VOTE_CAST`/`VOTE_FLAGGED` audits together; duplicate and quota
  checks precede it, and a DB unique constraint backs the application check.

## Voting integrity

Rate limiting is a DB-backed fixed-window counter (`RateLimitCounter`) that survives
restarts and works across app instances. Duplicate prevention is a unique constraint.
Velocity heuristics (per-user and per-IP-hash windows) attach `SUSPICIOUS`/`CRITICAL` flags
with reasons — they inform humans, they never auto-punish. Ballot order is shuffled
server-side from a seed derived from (event, user, hour-bucket), stable per session and
different across voters. Hidden results are enforced at the API layer: while
`votingResultsHidden && votingOpen`, public results endpoints 403 and vote counts are
omitted from public payloads.

## Audit logging

Every mutation of consequence writes an `AuditLog` row (actor, action enum, resource,
resourceId, JSON metadata) — 28 action types from `USER_CREATED` to `WEBHOOK_DELETED`.
Critical paths write the audit row inside the same transaction as the mutation. The
organizer console offers a filterable viewer; `GET /api/audit-log` is a first-class endpoint.

## API

- `handler()` wraps every route: Zod validation → 422 with field paths; `ApiError` →
  structured `{error:{code,message,details}}`; unknown errors → generic 500 (no leakage).
- OpenAPI 3.1 is generated from a typed object at `src/app/api/openapi.json/route.ts`,
  served live at `/api/openapi.json`, browsable at `/docs/api`, and exportable to
  `openapi.yaml` via `npm run openapi:export`.

## Deployment

`docker compose up` = PostgreSQL 16 + the app. The entrypoint waits for the DB healthcheck,
runs `prisma migrate deploy`, seeds if empty, then starts `next start`. No other services,
no network access required after images are pulled. `APP_SECRET` signs webhooks and
certificate verification hashes; `COOKIE_SECURE=true` enables Secure cookies behind TLS.

## Decisions worth knowing

1. **Single app, not microservices** — one deployable keeps self-hosting honest; service
   boundaries live in `src/server/*` and could be extracted without touching call-sites.
2. **DB-backed rate limiting over in-memory** — correctness across restarts and workers
   beats a microsecond of latency in an offline-first platform.
3. **Pure-function engines over stored procedures** — the statistical core is unit-testable
   TypeScript, deterministic by construction, and reusable by scripts (e.g. the
   normalization proof fixture generator).
4. **Hash-verified certificates** — integrity relative to the deployment secret; PKI is
   deliberately out of scope for self-hosted events.
