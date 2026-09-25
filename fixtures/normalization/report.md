# Normalization Proof — Dogfood 2026

Generated 2026-09-25T18:47:00.250Z by `scripts/normalization-proof.ts` using the production
normalization engine (`src/server/judging/normalization.ts`) over the seeded fixture data.

## Why normalization applies

The seed deliberately encodes divergent judge calibration: one lenient judge averages ~91
while a harsh judge averages ~68. Averaging raw scores treats that gap as project quality,
which it is not. Per-judge z-scores re-center each judge before projects are compared.

## Judge distributions (raw weighted scores)

| Judge | n | mean | σ | status |
|---|---|---|---|---|
| Jia Judge | 9 | 87.5 | 8.03 | normalized |
| Marta Kovacs | 7 | 75.89 | 8.95 | normalized |
| Jamal Reyes | 9 | 51.11 | 13.94 | normalized |
| Yuki Tanaka | 8 | 77.03 | 11.49 | normalized |
| Sam Okafor | 1 | 63.75 | 0 | insufficient-data |

- **normalized** — z-scores computed, winsorized at ±2.5, mapped to 50 + 10z.
- **insufficient-data** — fewer than 5 completed judgements; scores left raw and excluded
  from normalized rankings (no interpolation is performed).
- **zero-variance** — judge gave identical scores; z = 0 by definition.

## Ranking changes

13 of 14 ranked projects changed position after normalization.

| Project | Raw mean | Normalized | Raw rank | Normalized rank |
|---|---|---|---|---|
| ForgeLLM | 86.88 | 55.95 | 1 | 4 |
| PaletteOS | 82.5 | 61.45 | 2 | 1 |
| TestGhost | 80.42 | 51.41 | 3 | 7 |
| ThermalSense | 79.38 | 48.43 | 4 | 9 |
| DocDrift | 77.5 | 58.4 | 5 | 2 |
| PulseBench | 77.5 | 46.81 | 6 | 10 |
| ChordSeeker | 75.63 | 54.54 | 7 | 5 |
| LicenseHawk | 74.17 | 43.74 | 8 | 13 |
| StandupZERO | 73.75 | 57.75 | 9 | 3 |
| ArgusAnnotate | 70.63 | 51.61 | 10 | 6 |
| GripForce | 64.58 | 48.74 | 11 | 8 |
| ShipFast CI | 61.25 | 46.71 | 12 | 11 |
| HackMap | 59.17 | 44.21 | 13 | 12 |
| PromptForge | 49.38 | 30.76 | 14 | 14 |

Files: `before.csv` (raw), `after.csv` (normalized, with z and notes).

## Limitations of the method

1. **Sparse overlap** — z-scores are only comparable when judges share projects; with
   few common assignments the estimates are noisy.
2. **Normality assumption** — z-scores assume roughly symmetric judge behavior; heavily
   skewed scoring still distorts rankings.
3. **Winsorization trade-off** — capping at ±2.5σ limits outlier influence but also
   compresses genuine signal from exceptional projects.
4. **Equal-weight mapping** — 50 + 10z is a display convention, not a calibrated
   probability; only relative order is meaningful.
5. **No confidence intervals** — judges with few scores get point estimates without
   uncertainty; the lab UI surfaces per-judge n for this reason.
