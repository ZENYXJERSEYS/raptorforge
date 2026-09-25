# Threat Model

Scope: RaptorForge as a self-hosted, offline-capable hackathon platform. Trust boundaries:
browser ↔ app, app ↔ database, organizer ↔ participants, judges ↔ everyone. Heuristic
integrity signals are designed to **inform humans, never to auto-accuse** — every flag in the
UI carries that disclaimer.

| # | Threat | Attack scenario | Impact | Likelihood | Mitigation | Residual risk |
|---|--------|-----------------|--------|-----------|------------|---------------|
| 1 | **Sybil voting** | Attacker registers many accounts, votes once per project with each | Skewed community awards | Medium | Registration is open by design (hackathons), so detection is behavioral: per-user vote quotas (`votesPerUser`), DB-unique (user,project) votes, fixed-window rate limits, per-IP-hash velocity flags (SUSPICIOUS at 12/5min, CRITICAL at 25/5min) surfaced in the integrity dashboard | Determined attacker with many clean IPs is hard to distinguish from enthusiasm; organizers review flags manually |
| 2 | **Ballot stuffing** | Coordinated burst of votes for one project in a short window | Community Choice prize stolen | Medium | Velocity heuristic flags exact bursts (the seed includes a 12-votes-in-41s account), `VOTE_FLAGGED` audit entries record every flag with reason, flagged CSV export enables post-hoc review; results can stay hidden until voting closes | If flags are ignored, stuffing succeeds; the system makes review easy, not mandatory |
| 3 | **Submission scraping** | Competitor or bot harvests all project ideas/descriptions via the gallery API | Idea theft, privacy | Low–Medium | Gallery is public by design for hackathons; rate limits (page ≤ 50, IP-based registration/login limits) blunt bulk harvesting; drafts are never exposed (status filter), DQ'd projects return 404 | Public data is public; events wanting closed galleries can keep status DRAFT→SUBMISSIONS_CLOSED |
| 4 | **Judge collusion** | Judges share scores/strategies, or a judge reviews their own team's work | Biased outcomes | Low | Conflict of interest is *structural*: judges are team members never assignable to their own team (filtered pre-ranking + post-check, unit-tested); judge↔judge score visibility is impossible by API design (queue returns only own assignments; no endpoint exposes others' judgements to judges) | Collusion outside the platform is undetectable; rotating assignment seeds mitigates persistence |
| 5 | **Deadline gaming** | Client clock rolled back, replayed requests, HTTP method swaps to submit after the deadline | Late submissions accepted | Medium | `enforceSubmissionDeadline` uses `Date.now()` on the **server only**; submit is POST-only with status validation; late attempts get 423 `SUBMISSION_DEADLINE_PASSED`; integration test proves a submission 3.5s past the server deadline is rejected regardless of client behavior | Server clock skew itself (mitigated: containers sync via standard clock); an organizer can move the deadline explicitly, which is audited |
| 6 | **Unauthorized score access** | Participant/judge probes APIs for other judges' scores or hidden rankings | Judging integrity collapse | Medium | Role guards on every route (`requireJudge`/`requireEventOrganizer`), resource-scoped queries (queue/judgements filtered by the *authenticated* judge), hidden-results enforced at the API layer (403 while voting open + results hidden), public payloads never include `weightedScore`/`normalizedMean` (asserted in tests) | A compromised organizer account sees everything — organizers are trusted staff by definition |
| 7 | **Privilege escalation** | Participant edits own JWT/role, calls organizer endpoints, or adds themselves as event organizer | Full platform compromise | Low | Roles live server-side in the DB; sessions carry opaque random tokens (no client-side claims to forge); every mutating route re-verifies role/ownership/event-membership server-side; integration tests assert 403s for cross-role calls (participant→organizer endpoints, non-assigned judge→judgements) | Application-level authz bug would be the failure point; tests pin the critical paths |
| 8 | **Session theft** | Cookie exfiltrated via XSS, network sniffing, or shared machine | Account takeover | Medium | `httpOnly` cookies (unreadable by JS), `SameSite=Lax` (CSRF-resistant), `Secure` when `COOKIE_SECURE=true` behind TLS, tokens stored only as SHA-256 hashes (DB theft ≠ session forgery), logout destroys server-side, 7-day expiry with sliding renewal | Malicious browser extension or physically shared machine can still ride an active session; TLS off in the default offline demo (http://localhost) by design |
| 9 | **API abuse** | Scripted hammering of registration/login/votes/comments | DoS, resource exhaustion, spam | High | DB-backed fixed-window rate limits: login 30/min/IP, registration 20/min/IP, votes 10/min/user, comments 5/min/user; all return 429 with retry info; pagination caps page size at 50/100 | Distributed abuse of *legitimate-looking* traffic still requires the human review in #1/#2 |
| 10 | **Rate-limit bypass** | Attacker rotates IPs or accounts to dodge windows | Turns #9 into #1/#2 | Medium | Rate limits are per-subject where identity exists (user id for votes/comments — rotation-proof) and per-IP only where no identity exists (login/register); cross-account correlation via salted `ipHash` velocity flags catches IP-rotation patterns | IPv6 rotation with per-IP limits only is possible; the salted hash correlation is the second line |
| 11 | **Malicious submissions** | XSS/HTML injection through project names/descriptions/comments; `javascript:` URLs | Session theft of viewers/judges, phishing | Medium | React escapes all rendered strings by default (no `dangerouslySetInnerHTML` anywhere); all user URLs validated to `http(s)` by Zod + `isValidUrl` before storage; input length caps everywhere; comments rate-limited | Trusted-HTML feature added later would need CSP review; `rel="noreferrer noopener"` on external links |
| 12 | **Data leakage** | Errors expose stack traces/secrets; CSV exports leak private data; embed leaks judging info; certificates expose PII | Privacy violation, recon aid | Medium | Structured error envelope — unknown errors collapse to generic 500 (no stack traces); secrets never in client bundles (server-only `src/server/*` modules); exports require organizer role and are audited (`CSV_EXPORTED`); embed renders public project fields only; certificate verification shows given name + event + achievement only, never email/full name | Misconfigured reverse proxy logging cookies; exports downloaded by an authorized-but-curious organizer (audit trail exists) |

## Integrity principle

Detection heuristics (velocity, duplicates, IP correlation) produce **flags with reasons**,
never punishments. The integrity dashboard's own header states: *"Flags are heuristic
indicators of unusual velocity, not proof of fraud. Review before acting."* This is a
deliberate product decision: false accusations at hackathons are more damaging than a stolen
community award, and human review with good tooling beats opaque auto-punishment.

## Abuse cases we explicitly do not claim to stop

- Organizers overriding results (they own the platform; every such action is audited).
- Off-platform collusion between participants.
- Attacks on the host machine, Postgres, or Docker itself — out of application scope.

## Testing the model

The acceptance suite executes the load-bearing mitigations: server-side deadline rejection
(#5), hidden-results API enforcement (#6), cross-role 403s (#7), duplicate-vote conflict (#1),
quota exhaustion (#9), tamper-evident certificate verification (#12), and signed webhook
delivery. `npm run offline:check` additionally fails the build if any external service
reference appears in runtime code.
