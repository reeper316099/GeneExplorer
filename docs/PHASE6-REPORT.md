# Phase 6 report — Milestone C (structure overlay)

Screenshots: `docs/screenshots/overlay-1-*.png`, `overlay-2-*.png` (live runs, full Compare page; overlay card at the bottom).

## Results (live, real AlphaFold models)
| Pair | Identity | RMSD at pLDDT ≥ 70 | at ≥ 50 | at ≥ 90 |
|---|---|---|---|---|
| Human TP53 vs mouse Trp53 (close) | 78.6% | 2.85 Å over 228 of 387 aligned positions | 4.69 Å over 260 | 0.17 Å over 194 |
| Human CDK1 vs yeast CDC28 (distant, no source calls them orthologs) | 60.7% | 1.19 Å over 261 of 290 | 1.95 Å over 280 | 0.62 Å over 196 |
| Human TP53 vs E. coli lacZ | 28.8% | **refused**: identity below the 30% needed; the app shows the identity and the reason | | |

The TP53 numbers show why the caveats matter: the same pair gives 0.17 Å on the very confident core but 4.69 Å once flexible regions are admitted, so the threshold, the positions used and the totals are always shown next to the number.

## What was built
- `src/core/overlay.ts`: pairs residues through the alignment, keeps positions with pLDDT ≥ threshold in BOTH models, superimposes B onto A with the app's own Horn/Kabsch code, returns RMSD, used/aligned counts and per-pair distances (used or not). Refuses with a stated reason when the sequences are dissimilar (identity under 30%), too few confident positions remain (under 10), there is no alignment, or a model is missing.
- `src/bio/pdb.ts` `transformPdb`: applies the rotation and shift to every atom of B's file for display (only coordinates change; all other columns kept).
- Overlay card: one 3Dmol viewer with A (blue) and B (orange, moved onto A) and a text legend; pLDDT threshold slider with a live count (default 70); RMSD to two decimals; caveats (RMSD depends on the residues used, flexible loops and low-confidence regions are left out by design, prediction-vs-prediction is not an experimental measure, large length difference or low identity makes a single global RMSD misleading); per-position distance plot (solid = used, pale = left out); exports: overlay PNG and aligned-position CSV with a provenance header.

## Verification
- Typecheck, ESLint, Prettier clean. 262 unit/property tests (new: PDB transform preserves other columns; rigidly moved copy gives RMSD ~ 0 using every position; only positions confident in both models are used; a higher threshold never uses more positions; all refusal cases; real human/mouse p53 models; CSV). 33 end-to-end tests.
- The superposition itself was already checked against Biopython's SVDSuperimposer in Phase 3 (17 reference cases).

## Honest gaps
- A per-domain superposition (stretch goal) is not built; a single global RMSD is shown with its caveats.
- The 30% identity and 10-position limits are the app's own conservative choices, not published standards.
- Only the displayed fragment of a multi-fragment model is used (none of the test genes has fragments).
- RMSD is computed on C-alpha atoms only.
