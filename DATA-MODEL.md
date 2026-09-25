# Data Model

PostgreSQL 16 via Prisma. 25 tables, FK integrity throughout, unique constraints where
invariants must hold even under races, indexes on every hot path. The source of truth is
`prisma/schema.prisma`; this document explains the *why*.

## ER overview

```
User ─┬─< Session
      ├─< TeamMember >─ Team ───────< Project >─┐
      ├─< Team (as owner)      │                │
      ├─< EventOrganizer >─ Event              │
      ├─< Judge >──────────┤  │                │
      │                    │  ├─< Track ──────┤
      │                    │  ├─< Prize       │
      │                    │  ├─< Rubric ─< RubricCriterion
      │                    │  ├─< NormalizationRun
      │                    │  ├─< EventResult
      │                    │  ├─< WebhookEndpoint ─< WebhookDelivery
      │                    │  └─< Vote >───────┤
      │                    │  └─< Comment >────┤
      │                    │                   │
      │                    └──< JudgeAssignment >┘
      ├─< Judgement >─┬─< CriterionScore >─ RubricCriterion
      │               └─< ScoreChange            (audit history)
      ├─< PairwiseComparison (judgeId, projectA, projectB, winner)
      ├─< Certificate
      └─< Vote / Comment (as author)

AuditLog (actorId nullable → system actions)
RateLimitCounter (key, window bucket)
```

## Entities

### Identity & sessions
- **User** — `email` unique, `role` ∈ PARTICIPANT/JUDGE/ORGANIZER/ADMIN, `status` ACTIVE/
  DEACTIVATED. Passwords are scrypt hashes (`scrypt$salt$key`), never plaintext.
- **Session** — stores only the SHA-256 hash of the session token; a stolen DB dump cannot
  mint sessions. 7-day expiry, sliding renewal inside 24h of expiry. `ON DELETE CASCADE`
  with user.

### Events & configuration
- **Event** — lifecycle (`status` DRAFT→…→ARCHIVED), all dates including
  `submissionDeadline` (enforced server-side), judging configuration
  (`judgingMode` RUBRIC/PAIRWISE, `judgesPerProject`, `assignmentSeed` — the deterministic
  assignment seed), voting configuration (`votingEnabled`, window, `votesPerUser`,
  `votingResultsHidden`, `randomizedOrdering`), `maxTeamSize`.
- **EventOrganizer** — per-event organizer grant (m-n with User); ADMIN bypasses via code.
- **Track** — per-event, `eventId+slug` unique; optional `capacity`.
- **Prize** — `kind` OVERALL/TRACK/CUSTOM; optional `trackId` (`ON DELETE SET NULL` so
  deleting a track doesn't destroy prize history), `rank` orders assignment priority.
- **Rubric / RubricCriterion** — one rubric per event; criteria carry `weight` (percent,
  validated to sum to 100), per-criterion `minScore`/`maxScore` (mixed scales supported),
  `required`, `order`. Replacing a rubric bumps `version`; stored judgements keep their
  original computed score.

### Teams & submissions
- **Team** — unique name per event; owner is a User.
- **TeamMember** — `teamId+userId` unique ⇒ one membership per team; the app additionally
  enforces one team per user **per event**. `role` OWNER/MEMBER.
- **TeamInvite** — only the SHA-256 `tokenHash` is stored (invite links in the DB are
  useless to an attacker), with `status` and `expiresAt`; single-use (`usedBy`).
- **Project** — the submission. `eventId+teamId` unique (one project per team),
  `eventId+slug` unique; `technologies` as a string array (GIN-friendly), `status`
  DRAFT/SUBMITTED/LOCKED/DISQUALIFIED, `submittedAt`. Lock transition happens server-side
  at/after the deadline or by organizer moderation.

### Judging
- **Judge** — per-event judge profile; `userId+eventId` unique; `status` INVITED/ACTIVE/
  DEACTIVATED (deactivated judges lose queue access immediately); `expertise` string array
  used by the assignment affinity.
- **JudgeAssignment** — `judgeId+projectId` unique; `reason` column stores the engine's
  written explanation ("no conflict · workload 2 · track expertise match (1)") for audits.
- **Judgement** — one per (judge, project); stores the server-computed `weightedScore` and
  `rubricVersion` at scoring time.
- **CriterionScore** — raw per-criterion value, `judgementId+criterionId` unique; both raw
  and computed are kept so results are always reproducible.
- **ScoreChange** — append-only history: `oldValue`, `newValue`, `action` CREATED/UPDATED,
  `actorId`, timestamp. Score edits are never silent; the lab and CSV exports can replay
  the full evolution of any judgement.
- **PairwiseComparison** — judge, projectA, projectB, winner ∈ A/B/TIE; duplicate-pair
  prevention per judge is enforced in the service (direction-insensitive).

### Community
- **Vote** — `userId+projectId` unique (one vote per user per project, DB-enforced);
  `ipHash` is a salted SHA-256 of the client IP (never the raw IP), `flagLevel`
  NORMAL/SUSPICIOUS/CRITICAL with `flagReason` — heuristic flags, never verdicts.
- **Comment** — soft deletion via `isHidden` preserves moderation history; author
  `ON DELETE CASCADE`.

### Platform
- **AuditLog** — actor nullable (system), `action` enum (28 types), `resource`+
  `resourceId`, JSON `metadata`. Indexed by action, resource, and time.
- **Certificate** — human-facing `certificateId` (e.g. `RF26-7A82F1`) unique;
  `verificationHash` = SHA-256 over (APP_SECRET, id, userId, eventId, achievement,
  issuedAt) truncated to 32 hex; unique per (event, user, achievement).
- **NormalizationRun** — persisted engine runs: method, params, before/after JSON —
  the normalization proof is regenerable and auditable.
- **EventResult** — materialized results snapshot with `published` flag; public visibility
  is gated by this flag plus the event's hidden-results configuration.
- **WebhookEndpoint / WebhookDelivery** — endpoints hold a per-endpoint `secret` for
  HMAC-SHA256 signatures; deliveries persist payload+signature **before** dispatch with
  status/attempts/lastError for retry with backoff.
- **RateLimitCounter** — fixed-window counters keyed by (subject, window-bucket); unique
  on (key, window) makes increments race-safe.

## Cascade policy

Deletes cascade along ownership (user→sessions, team→members, project→judgements/votes/
comments) so removing a team or user leaves no orphans. Edges that must survive deletion
use SET NULL (prize→track, project→creator, audit→actor) to preserve history. Destructive
organizer actions (disqualify) never delete — they set status.
