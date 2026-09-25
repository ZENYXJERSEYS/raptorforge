# Judging — design & methodology

This document explains exactly how RaptorForge turns judge opinions into rankings. Every
algorithm here is a pure, deterministic TypeScript function in `src/server/judging/`, covered
by unit tests, and rendered transparently in the organizer Normalization Lab — no black boxes.

## 1. Judge assignment

**Goal:** every project gets `judgesPerProject` judges, work is balanced, conflicts of
interest are impossible, and the result is reproducible and explainable.

**Algorithm** (`computeAssignments`):

1. **Deterministic shuffle** — projects are ordered by a seeded Fisher–Yates shuffle
   (`event.assignmentSeed`) so no team is systematically first-come-first-served across
   regenerations.
2. **Eligibility filter** — judges whose `userId` appears in the project's team member list
   are removed *before* ranking. Conflicts of interest are structurally impossible, not
   merely penalized; a final re-check enforces this invariant again after selection.
3. **Ranking** — eligible judges are sorted by (track-expertise affinity desc, current load
   asc, deterministic id tiebreak). Affinity counts how many of the judge's `expertise`
   keywords match the track's keyword list (derived from track names).
4. **Selection** — the top `judgesPerProject` judges are taken; loads are updated; each
   decision records a reason string, e.g.
   `no conflict (judge not on team) · workload 2 · track expertise match (1)`.
5. **Shortfall reporting** — when fewer eligible judges exist than requested, the project is
   reported in `unassigned` with an explicit reason; the generator returns 201 with this
   report rather than silently under-covering.

**Properties:** same inputs + seed ⇒ byte-identical output (unit-tested); workload spread
≤ 1 between the busiest and least busy judge with uniform demand (unit-tested); inactive
judges are excluded. Regeneration replaces the assignment set atomically in one transaction.

## 2. Rubric scoring

Criteria are configured per event with weights summing to exactly 100 (validated server-side,
422 otherwise). Each criterion may use its own scale (`minScore`…`maxScore`).

```
weightedScore = Σ_criterion  ((value − min) / (max − min)) × weight
```

This normalizes mixed scales (1–5 and 0–10 can coexist) into a 0–100 score. The computation
happens **only on the server**; clients submit raw criterion values and never trusted totals.
Both the raw `CriterionScore` rows and the computed `Judgement.weightedScore` are stored, so
any result can be re-derived forever. Out-of-range values are clamped defensively.

**Immutability & audit:** every judgement upsert appends `ScoreChange` rows
(old value → new value, CREATED/UPDATED, actor, timestamp) inside the same transaction.
Historical judging data is never silently overwritten.

## 3. Cross-judge normalization

**Problem:** judges calibrate differently. A lenient judge averaging 91 and a harsh judge
averaging 51 may agree completely about *relative* quality; averaging their raw scores turns
calibration into a project-quality error.

**Method:** per-judge z-score over that judge's completed weighted scores:

```
z          = (score − judgeMean) / judgeSigma
normalized = 50 + 10·z          (fixed linear map to a 0–100 display scale)
```

**Edge handling (deterministic, documented in the lab UI):**

| Case | Rule |
|---|---|
| Judge has < 5 completed judgements | left raw, `insufficient-data`, excluded from normalized rankings (no interpolation across missing scores) |
| Judge σ = 0 (identical scores) | z = 0 → 50, `zero-variance` |
| Outliers | z winsorized to ±2.5 so one extreme score cannot dominate |
| Missing scores | never imputed; only completed judgements count |

**Why this works:** z-scores measure each score *against the judge who gave it*. A 62 from a
judge whose average is 67 carries different information than a 62 from a judge whose average
is 40. The winsorization cap trades a little tail information for robustness.

**Demonstrability:** the seed deliberately includes judges averaging ~91, ~78, ~77, ~75 and
~51. `npm run proof:normalization` regenerates `fixtures/normalization/before.csv`,
`after.csv`, and `report.md` from the real engine over the seeded event — including the count
of ranking positions that changed. The lab page shows raw vs normalized per score, judge
stats (n, mean, σ, status), and the raw-vs-normalized ranking with moved rows highlighted.

**Limitations** (also in the generated report): z-scores assume roughly symmetric judge
behavior; sparse judge-project overlap makes estimates noisy; winsorization compresses
genuine outliers; the 50+10z map is a display convention — only relative order is meaningful;
no confidence intervals are computed for small-n judges (their n is surfaced instead).

## 4. Pairwise mode (Bradley–Terry with Davidson ties)

Organizers can switch `judgingMode` to PAIRWISE. Judges then record A / B / TIE outcomes
instead of rubric scores.

**Model.** Each project *i* has strength `pᵢ > 0`:

```
P(i beats j) = pᵢ / (pᵢ + pⱼ + ν·√(pᵢ·pⱼ))
P(tie)       = ν·√(pᵢ·pⱼ) / (pᵢ + pⱼ + ν·√(pᵢ·pⱼ))
```

ν = 1 (configurable) recovers plain Bradley–Terry at ν = 0. Davidson's extension keeps ties
informative without collapsing strengths.

**Estimation.** Minorization–maximization (MM) iteration:

```
pᵢ ← (winsᵢ + ½·tiesᵢ) / Σ_{j≠i} nᵢⱼ / (pᵢ + pⱼ + ν·√(pᵢ·pⱼ))
```

Iterated to convergence (ε = 1e-8, ≤ 500 iterations). MM is monotone, stable, and needs no
randomness — same comparisons ⇒ same strengths, every time. Strengths are min-max scaled to
0–100 for display; only relative order is meaningful.

**Minimum data.** Projects with fewer than 3 comparisons are flagged below-minimum in the
UI; projects with zero comparisons are listed as isolated with baseline strength. The
comparison graph should be connected for global rankings — the UI reports isolation instead
of hiding it.

**Assumptions & limitations:** BT assumes transitive latent strengths and independence
between comparisons; with few comparisons per pair the variance is high (n is always shown);
ties are modeled but many ties reduce discriminative power; the estimator is robust to
judge identity (pairwise comparisons are calibration-free by construction) but not to
strategic voting.

## 5. Ranking & prizes

- **Rubric mode:** projects ranked by raw mean and (separately) by normalized mean; the lab
  reports how many positions move. Published results show both.
- **Pairwise mode:** ranked by BT strength.
- **Ties:** same score ⇒ same rank (competition ranking), deterministic order by id.
- **Prize assignment:** prizes are processed in `rank` order (overall first, then track,
  then custom); each prize takes the highest-ranked *unassigned* project in its scope.
  A project can win multiple prizes only if no better candidate remains — the assignment
  list is persisted with every results run.

## 6. Reproducibility

1. Assignment seed stored on the event; regeneration is deterministic (tested).
2. Raw criterion scores + computed weighted score stored per judgement.
3. Every normalization run persisted (`NormalizationRun`) with method + parameters.
4. Every results run persisted (`EventResult`) with the full payload.
5. `npm run proof:normalization` regenerates the proof fixtures from stored data.
6. The acceptance suite re-executes the scoring example (4/5/4/3 → 90 on a 40/60 rubric)
   against the live server.
