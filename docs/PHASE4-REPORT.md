# Phase 4 report — Milestone A (gene lookup)

Screenshots (light and dark, plus the 1200x760 minimum size) are in `docs/screenshots/`; regenerate with `node scripts/build.mjs --dev && node tools/screenshots.mjs`.

## Test-gene run (live network, real app, hidden window)
| Gene | Result |
|---|---|
| TP53, human | Full page. NCBI Gene 7157 + UniProt P04637 (reviewed), link confirmed both ways, 11-exon MANE Select transcript, chr17 length, AlphaFold mean pLDDT 75.1 |
| Trp53, mouse | Full page, AlphaFold mean pLDDT 73.3 |
| tp53, zebrafish | Full page, AlphaFold mean pLDDT 76.8 |
| lacZ, E. coli | NCBI lists no UniProt entry, so the protein was found through UniProt's GeneID cross-reference (shown in a note); no transcript record (protein-only gene model, explained); AlphaFold 97.9 |
| FLC, Arabidopsis | Same cross-reference path (8 UniProt entries, reviewed one shown); AlphaFold 79.4 |
| wg, fruit fly | Same path; AlphaFold 75.6 |
| CDC28, yeast | Same path; AlphaFold 89.5 |
| rbcL, Arabidopsis (chloroplast) | Organelle sequence NC_000932.1 with length; protein-only model note; AlphaFold 96.8 |
| TTN, human (titin) | Page loads; AlphaFold DB has no model for Q8WZ42, shown with a reason instead of a blank |
| TP53, naked mole-rat | Unreviewed UniProt entry: "automatic annotation" warning, 11 of 11 GO terms automatic; no AlphaFold model; sequence length "not available" |
| COX1, human | Disambiguation list (only an alias of PTGS1); nothing opens until you choose |
| P0CG05 (obsolete) | Explained as split into P0DOY2 / P0DOY3 |

## Verification
- Typecheck, ESLint, Prettier clean. 229 unit/property tests pass; 31 live contract tests pass; 24 end-to-end tests pass (hidden window).
- Production build contains no test-mode code (0 markers).
- Colour tokens: `node tools/check-palette.mjs` — every text pair is at least 4.5:1 in light and dark; the Okabe-Ito palette stays separated under simulated protan, deutan and tritan vision (min deltaE 13.8, threshold 12) and the pLDDT scale (min 32.8, threshold 20). Categories also carry labels, patterns and legends.

## Not done / honest gaps
- "Has orthologs" lazy badge in results: not built (needs one NCBI call per result). The AlphaFold badge is built (first 8 results).
- Chromosome map for unplaced scaffolds shows "length not available" when NCBI's sequence report does not list the scaffold.
- AlphaFold licence text still not independently confirmed (the About page says so).
- Multi-fragment AlphaFold selector is implemented but untested (no large protein with fragments was tested; titin has no model).
- App icon and packaging: Phase 8.
- `Ctrl/Cmd+1..3` tabs, Back/Forward, focus search and dark mode menu commands work; export menu commands are acknowledged but the exports are reachable from the page buttons.
