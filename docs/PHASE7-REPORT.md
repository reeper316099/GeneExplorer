# Phase 7 report — testing (run 2026-11-18, macOS, Node 22, Electron 45)

Everything below was actually run. "LIVE" means the real services were called at the stated time.

## Checklist
| # | Item | Result |
|---|---|---|
| 1 | `npm run typecheck`, `npm run lint`, Prettier | **PASS** (zero errors; zero `any`: grep for `: any`, `as any`, `<any>`, `any[]` finds 0; 0 TODO/FIXME) |
| 2 | Unit/property tests | **PASS**: 271 tests in 17 files |
| 3 | Contract tests (LIVE, 2026-11-18 23:06 MST) | **PASS**: 58 checks, every recorded URL re-fetched, parsed by the same parser, top-level keys unchanged |
| 4 | Coverage (`@vitest/coverage-v8`, added with your OK, dev-only) | **MEASURED**: all listed files 90.9% statements / 77.9% branches / 88.7% functions / 94.1% lines (details below) |
| 5 | Biopython cross-check, fresh data (LIVE, 23:48) | **PASS**: 8 protein pairs, max score difference **0**; 4 structure pairs, max RMSD difference **3.3e-16 Å** |
| 6 | Spot-check of shipped facts vs independent sources (LIVE) | **PASS**: 9 genes, 8 species, 76 comparisons PASS, 0 FAIL, 14 informational lines |
| 7 | Live smoke test (`npm run smoke:live`, LIVE 2026-11-18 ~23:00) | **PASS** after one fix (see Findings): 8 genes x 6 source calls, no schema drift |
| 8 | Performance | **PASS with a noted caveat** (below) |
| 9 | Electron e2e (fixtures, hidden window) | **PASS**: 41/41 (after fixing the preference-flush bug, finding 3) |
| 10 | Security checks | **PASS** (e2e + unit; packaged-build flag test is a Phase 8 item) |
| 11 | Screenshots light/dark, human and non-human gene | **PASS**: `docs/screenshots/` (TP53 and E. coli lacZ, every main view) |

## Coverage (unit + property tests; e2e adds more on top)
| Area | Statements | Branches | Lines |
|---|---|---|---|
| `src/bio` (aligner, superposition, PDB, BLOSUM) | 98.5% | 77.0% | 99.6% |
| `src/core` | 89.3% | 78.9% | 90.3% |
| `src/api` | 85.6% | 70.3% | 94.0% |
| `electron/net.ts`, `electron/cache.ts` | 93.0% | 90.2% | 96.3% |
`gene-view.ts` and `resolve.ts` were the weakest and gained tests this phase (reproduce: `npx vitest run --coverage`). UI code (`src/ui`) is covered by the end-to-end tests, not by line coverage.
Tolerances used: alignment scores must match Biopython exactly (integers); RMSD vs Biopython 1e-6 Å in tests (observed 3e-16); mean pLDDT vs the PDB file's B-factor mean 0.1 (observed up to 0.03, rounding); floating-point tests use `toBeCloseTo` with 5-6 decimals because both sides are IEEE doubles.

## Independent cross-check (LIVE, Biopython 1.86, fresh UniProt/AlphaFold downloads)
Proteins: KRAS/HRAS, CDK1/CDC28, SOD1 human/mouse, cytochrome c human/yeast, GAPDH human/E. coli, hemoglobin beta human/zebrafish, calmodulin human/Arabidopsis, insulin human/chicken. Scores identical in all 8 (e.g. CDK1/CDC28 928). Structures (pLDDT ≥ 70 aligned CA atoms): KRAS/HRAS 0.7962 Å (n=173), CDK1/CDC28 1.1947 Å (261), SOD1 0.1591 Å (154), cytochrome c 0.5074 Å (103); app and Biopython agree to 1e-16. Reproduce with `tools/crosscheck.py` + `tools/crosscheck.ts`.

## Spot-check (LIVE; independent = NCBI E-utilities esummary/efetch, UniProt FASTA, AlphaFold PDB file B-factors, Alliance of Genome Resources)
Genes: human TP53 and CDK1, mouse Trp53, zebrafish tp53, E. coli lacZ, Arabidopsis FLC and rbcL, fruit fly wg, yeast CDC28. Full table: run `python3 tools/spotcheck.py` (output kept in `scratch/spotcheck.log`). Examples:
| Gene | Field | App value | Independent value |
|---|---|---|---|
| TP53 (human) | coordinates | 7,668,421-7,687,490, minus | E-utilities chrstart/chrstop 7668420/7687489 (0-based) -> same |
| TP53 | exon count of NM_000546.6 | 11 | 11 exon features in the GenBank record |
| TP53 | protein length / mean pLDDT | 393 aa / 75.06 | UniProt FASTA 393 / PDB B-factor mean 75.05 |
| TP53 | ortholog | Trp53 (MGI:98834) | listed by the Alliance of Genome Resources |
| tp53 (zebrafish) | chromosome / coordinates | 5, 25,128,576-25,140,154 plus | identical |
| lacZ (E. coli) | exon count (coding region) | 1 | genomic CDS feature has no join |
| FLC (Arabidopsis) | protein / pLDDT | Q9S7Q7, 196 aa, 79.38 | 196 aa, 79.41 |
| CDC28 (yeast) | location | chr II 560,078-560,974 plus | identical |
| rbcL (chloroplast) | location | plastid, 54,958-56,397 plus | identical |
Notes: the first version of this check compared the displayed transcript's exon count with E-utilities' gene-model count, which are different quantities; it now checks the transcript's own GenBank record (11 = 11 for TP53; 8 = 8 for CDK1). For RefSeq records without exon features, only a weaker "not more than the gene model" check is possible and is labelled as such.
Informational finding: the Alliance lists 6 orthologs for fly wg and 15 for yeast CDC28, while NCBI Orthologs lists none. The app already words this correctly ("none in this source"; absence is not absence) and offers OrthoDB as a second source.

## Live smoke test (LIVE, 2026-11-18 about 23:00 MST, from this Mac)
All 8 genes x (NCBI gene, UniProt, NCBI product report, NCBI orthologs, AlphaFold, OrthoDB): PASS. Median latencies per host: NCBI 230-450 ms, UniProt 380-810 ms, AlphaFold 140-510 ms, OrthoDB 0.8 s (first call) up to ~4 s (group lookups). Ensembl is not used.

## Performance (real app, live network, hidden window, empty cache for the cold runs)
| Measure | Result |
|---|---|
| Time to first content, cold search (TP53) | ~2.4 s |
| Time to first content, cached search | ~60 ms |
| Structure shown, cold / cached | ~0.4-0.8 s / ~70 ms |
| Largest allowed alignment (2000 x 2000 = 4.0M cells) | 55 ms in Node (1000 x 1000: 20 ms); runs in a worker in the app |
| Memory | app working set ~410 MB at start, ~650 MB after one gene with 3D, ~850-890 MB after a large compare (CFTR vs MYH7, two big structures); renderer JS heap 163-171 MB |
| Responsiveness during a large compare (about 500 frames) | the alignment finished in ~0.8 s without blocking; 3 long tasks of 145-214 ms and 4 frames over 50 ms came from drawing the page and parsing the 3D structures, not from the alignment or superposition |
Caveat: those few 150-200 ms tasks are visible as tiny hitches; I reduced DOM size in the alignment text (about 10x fewer nodes) but did not eliminate them. Not a FAIL against "no long main-thread tasks during alignment and superposition", but not zero either.

## Findings from this phase (all fixed)
1. OrthoDB answers `{"data": null, "bigdata": null}` when no group contains a protein (rbcL). The schema rejected it, so the app showed a format error instead of "no group". Found by the live smoke test; fixed, with a new recorded fixture and a test.
2. Species autocomplete ranking (Phase 5), the identity-warning threshold and the history-stack loop (earlier phases) are in their own reports.
3. Real app bug: a theme or favorites change made right before quitting could be lost, because Chromium writes its storage to disk a moment later. The end-to-end restart test caught it. Fixed by flushing storage on `before-quit`; the restart test now passes in the full suite.

## End-to-end coverage vs the Phase 7 list
launch/title and a clean console (no errors, no unhandled rejections) through all flows; search by symbol with and without species, UniProt accession, NCBI Gene ID (two spellings), RefSeq accession, Ensembl ID, free text; disambiguation requires an explicit choice (alias list, any-species hit list); all tabs; one failing panel leaves the others working with Retry (unit + e2e); 3D viewer renders, pLDDT colour scale unit-tested at every band edge; feature click highlights residues; Species tab shows each source separately and "no ortholog" wording; compare for the close pair, a distant/no-ortholog pair, and cancel/re-run; the one-to-many pick flow is covered by a logic test because NCBI returned at most ONE ortholog per species for every gene/species combination I scanned (15+), so no real one-to-many fixture exists; overlay RMSD on a fixture pair and a graceful refusal; offline mode with cached gene working and an uncached gene failing politely; 429 with Retry-After shown in the status bar (simulated in test mode); exports (CSV, FASTA, JSON, PNG, PDF) through the native-dialog code path (test builds save to a folder instead of a dialog); security (nodeIntegration off, no `require`, no renderer network, blocked navigation, non-allowlisted hosts, non-https, path traversal); dark mode persistence across restarts.

## Not done / honest limits
- The packaged-build "test mode flag ignored" check needs a packaged app: Phase 8.
- Windows and macOS builds were not exercised except macOS dev runs.
- 1:many ortholog UI flow is not tested with real data (none exists in NCBI's output).
- Oversize-response rejection is tested at unit level in the net layer, not in e2e.
