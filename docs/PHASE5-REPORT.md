# Phase 5 report — Milestone B (species and comparison)

Screenshots: `docs/screenshots/*-5b-species.png`, `*-5c-compare.png` (light and dark).

## Three gene pairs / cases (live network, real app)
| Case | What the app showed |
|---|---|
| **Close pair**: human TP53 vs mouse Trp53 | NCBI Orthologs lists them ("Orthology reported", worded as inferred). Alignment identity 78.6% (304 of 387 aligned positions; 76.8% over all columns; 77.9% over the shorter sequence), similarity 84.2%. Field table, domain/feature layout on alignment columns, identity plot, GO overlap, gene structures, two 3D viewers. |
| **Distant pair**: human CDK1 vs yeast *S. cerevisiae* CDC28 | NCBI lists 863 vertebrate species only; OrthoDB's CDK1 group (default Tetrapoda) does not contain yeast; the two genes are in different OrthoDB groups. So the compare view says "No ortholog call found... does not show they share an ancestor" and still lets you compare them (both reviewed, 297 vs 298 aa). |
| **No human ortholog in the sources**: Arabidopsis FLC | NCBI Orthologs: no calls (explained as a source gap, not absence). OrthoDB: 22 plant species in 1 lineage group, no human call. |

## What was built
- Species tab: one section per source (NCBI Orthologs, OrthoDB), never merged; method and coverage text, data date, summary cards (species, lineage groups, 1:many species, human call), lineage chart, sortable/filterable/searchable table (Open gene, Compare), paralogs section (neither source provides them here), CSV export with a provenance header.
- OrthoDB group level chosen by a documented rule (broadest group of at most 1,500 genes, else the smallest) with a selector showing every level and its size.
- Compare tab: explicit gene B choice ("Find ortholog in species" via NCBI with a 1:many explanation, or any gene by symbol/ID with disambiguation), 12-field table with same / different / missing-in-A / missing-in-B / not-comparable and per-value provenance, alignment in a worker (progress, Cancel), three identity denominators, wrapped three-line alignment, overview (features of A, identity plot, features of B on alignment columns, domain boundaries), stacked gene structures (common-scale toggle), GO overlap (Jaccard), two 3D viewers with synchronized rotation, exports (table CSV, alignment FASTA, side-by-side PNG).
- PDF report via the main process (printToPDF) with print CSS: overview, location with diagrams, protein summary, structure image with pLDDT legend, ortholog summary per source, comparison table, provenance appendix, citations/licences, disclaimer. Checked on TP53: a real 5-page PDF whose text contains every section (text extracted with pypdf in the scratch venv); the 3D image is embedded.

## Verification
- Typecheck, ESLint, Prettier clean. 251 unit/property tests, 52 contract tests registered (2 run offline; the 31+ live ones passed earlier and the new fixtures were just recorded from the live APIs), 31 end-to-end tests pass (hidden window).
- Tests added: per-source ortholog tables, lineage grouping, CSV injection safety, all five field statuses, GO overlap, alignment wrapping/windows/progress, default OrthoDB group rule.

## Bugs found and fixed this phase
- Species autocomplete: UniProt taxonomy search ranked "mouse metagenome" first and never returned Danio rerio for "zebrafish". Switched to NCBI taxon suggest (Mus musculus, Danio rerio first).
- Lineage batches were order-dependent; they are now sorted so requests are deterministic and cache well.
- The low-identity warning threshold was raised from 25% to 30%: an unrelated pair (TP53 vs lacZ) aligned to 28.8% identity, which shows global alignment of unrelated proteins inflates identity.

## Honest gaps
- Neither source gives identity %, orthology type or paralogs; the table shows "–" and says so (never estimated).
- OrthoDB rows have no NCBI Gene ID, so "Open gene" becomes "Search symbol in species"; "Compare" exists for NCBI rows only (OrthoDB rows can be compared through the Compare tab).
- 4 of 396 OrthoDB species for CDK1 are "Unclassified" (NCBI taxonomy returned no lineage for them); they are not guessed into a group.
- Very large OrthoDB groups (>1,500 genes) are offered but flagged as large downloads; not exercised end to end.
- Sequences longer than about 2000 x 2000 residues are refused by the aligner (message shown).
- "Number of domains" counts UniProt "Domain" features only, so TP53 shows 0 (its features are regions and DNA-binding), which is what UniProt lists.
- PDF layout was verified by extracting its text and counting pages/images, not by looking at rendered pages.
- Structure overlay/superposition is Milestone C.
