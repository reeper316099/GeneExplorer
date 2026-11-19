# Phase 1 report (partial): data-source verification

Run 2026-11-18/19 from the dev Mac with Node 22.15.1. All numbers below come from real requests (probe scripts live in git-ignored `scratch/`). Items marked NOT RUN were not done.

## Sources verified live

| Source | Base URL | Verified endpoints | Notes |
|---|---|---|---|
| UniProt | `https://rest.uniprot.org` | `/uniprotkb/{acc}.json`, `/uniprotkb/search?query=gene_exact:X AND organism_id:N&fields=...`, `/taxonomy/search?query=` | 114 hits for TP53 human-filtered query; `x-total-results` and `Link: rel=next` cursor pagination; `fields=` trims the 849 KB TP53 / 487 KB titin entries; CORS `*` |
| NCBI Datasets | `https://api.ncbi.nlm.nih.gov/datasets/v2` | `/gene/id/{id}`, `/gene/symbol/{sym}/taxon/{taxid}`, `/gene/accession/{acc}`, `/gene/id/{id}/orthologs`, `/gene/id/{id}/product_report`, `/taxonomy/taxon/{id}`, `/taxonomy/taxon_suggest/{text}`, `/genome/accession/{acc}/sequence_reports` | header `x-ratelimit-limit: 5` (5 req/s without key); no CORS header seen; `/openapi.json` 404 |
| AlphaFold DB | `https://alphafold.ebi.ac.uk/api` | `/prediction/{uniprot}` (returns a list), `/openapi.json` | files at `https://alphafold.ebi.ac.uk/files/AF-{acc}-F1-model_v6.{pdb,cif,bcif}`; fields incl. `globalMetricValue` (mean pLDDT), `latestVersion`, `modelCreatedDate`, `fractionPlddt*` |
| OrthoDB | `https://data.orthodb.org/v12` | `/search`, `/group?id=`, `/orthologs?id=` | `/genes?id=&species=` does not exist (error says so) |
| Ensembl REST | `https://rest.ensembl.org` | NOT RUN: unreachable from this network (TLS handshake timeout on both IPs, repeated). `grch37.rest.ensembl.org` works, used only to check response shapes | see Blockers |

Hostnames to allowlist so far: `rest.uniprot.org`, `api.ncbi.nlm.nih.gov`, `alphafold.ebi.ac.uk`, `data.orthodb.org`, `rest.ensembl.org`; link-out only: `www.ncbi.nlm.nih.gov`, `www.uniprot.org`, `www.ensembl.org`, `www.orthodb.org`.

## Findings that differ from the prompt (reality wins)

- UniProt returns HTTP 200 for deleted/demerged accessions, with `entryType: "Inactive"`. Deleted example: `Z9Z9Z9` (`inactiveReasonType: DELETED`). Demerged example: `P0CG05` -> `P0DOY2, P0DOY3`. Treat this as the obsolete-ID test case, not a 404.
- UniProt `/suggest?dict=taxonomy` is 404. Use `/taxonomy/search`.
- NCBI Datasets rejects strain-level taxa for symbol lookup (E. coli 83333 gives `ABOVE_SPECIES_TAXON`, HTTP 200 with a warning and no reports). Use K-12 MG1655 (taxon 511145), which returned a record.
- NCBI not-found by gene ID is HTTP 400 with an `Invalid argument` message, not 404.
- NCBI human `COX1` symbol resolves to `PTGS1` (an alias collision). This is a ready-made disambiguation test: the mitochondrial gene is `MT-CO1`.
- NCBI ortholog response for human TP53 (7157) is 1.3 MB, 669 reports, all species seen were vertebrates; no yeast, fly or Arabidopsis. It needs `taxon_filter=` (returned 13.7 KB for zebrafish) to keep payloads small.
- NCBI gene report gives `chromosomes: ["Plastid: chloroplast"]` for Arabidopsis rbcL (organelle handling is in this string, `NC_000932.1`, sequence_name `Pltd`). Human TP53 has two annotations (GRCh38.p14 and T2T-CHM13), so the app must pick one and say which.
- AlphaFold `/prediction/Q8WZ42` (titin) is 404; the TP53 entry is a one-element-per-fragment list (`AF-P04637-F1`). Large-protein fragment behavior needs a closer look (the summary endpoint also returned `{}`).
- OrthoDB group ID from UniProt (`5915660at2759`) returned `data: null` on the v12 API (UniProt may reference an older release); the bacterial one (`9758603at2`, lacZ beta-galactosidase) worked. OrthoDB `/orthologs` for a bacterial group is 6.9 MB, so it must be paged or filtered by species.
- Ensembl GRCh37 server has no `/homology` endpoint (404), so homology shape stays unverified.

## Test gene set status

| Gene | UniProt | NCBI | AlphaFold | Notes |
|---|---|---|---|---|
| Human TP53 | yes (P04637, reviewed) | yes (7157) | yes (v6, mean pLDDT 75.06) | OrthoDB id `5915660at2759` returned null |
| Mouse Trp53 / zebrafish tp53 | NOT RUN | yes (22059 / symbol lookup 200) | NOT RUN | |
| E. coli lacZ | yes (P00722) | yes via taxon 511145 | yes (200) | GeneID 945006 |
| Arabidopsis FLC | yes (13 hits) | yes (830878) | NOT RUN | |
| Arabidopsis rbcL (plastid) | yes | yes (844754, plastid) | NOT RUN | |
| Drosophila wg | NOT RUN | yes (200) | NOT RUN | |
| S. cerevisiae gene | NOT RUN | GAL4 returned 200 | NOT RUN | |
| Titin | yes (Q8WZ42, 487 KB) | yes (7273) | 404 | |
| Obsolete ID | yes (Z9Z9Z9, P0CG05) | n/a | n/a | |
| Symbol collision | n/a | COX1 -> PTGS1 | n/a | |
| Auto-annotation-only species | NOT RUN | NOT RUN | NOT RUN | |

## Tooling and versions (npm view, checked now)

electron 45.3.4, electron-vite 6.0.0 (last modified 2026-10-14; peers vite ^6/^7/^8), electron-builder 26.18.0, vite 8.3.8, typescript 7.0.2, zod 4.6.7, fast-check 4.10.3, vitest 5.1.1, @playwright/test 1.65.1, 3dmol 2.5.5 (ships `build/types/index.d.ts`), chart.js 4.6.1, eslint 10.15.0, typescript-eslint 8.73.0, prettier 3.10.1, esbuild 0.28.2. Biopython on PyPI: 1.88 (not installed locally yet). Not yet tested: compatibility between these specific versions (notably TypeScript 7 with typescript-eslint, and vitest 5 with vite 8).

3Dmol 2.5.5 minified build: 0 occurrences of `new Function`, 1 of `eval(` (could be a string/comment). Whether it runs under a CSP without `unsafe-eval` is NOT YET TESTED and must be run in Electron.

BLOSUM62: NCBI's FTP copy (`ftp.ncbi.nlm.nih.gov/blast/matrices/BLOSUM62`, a standard 24x24 file with B, Z, X, *) is reachable. Second-source cross-check against Biopython's bundled matrix: NOT RUN.

## Not done in this pass (Phase 1 items)

Ensembl verification, OrthoDB ID-linkage for the full gene set, idmap statistics, `tools/record-fixtures.ts`, search-ranking and algorithm write-ups in `ALGORITHMS.md`, license quotes for NCBI/AlphaFold/Ensembl (UniProt and OrthoDB pages showed CC BY 4.0 links), electron-vite + sandboxed preload + worker + printToPDF feasibility, proposed cache caps/TTLs.

## Blockers

- `rest.ensembl.org` does not complete a TLS handshake from this network (other EBI hosts work). Likely network-level.

---

# Part 2 (Ensembl skipped by decision)

## ID-mapping results (live, 11 genes; `scratch/idmap.mjs`)

| Link | Result |
|---|---|
| UniProt -> NCBI GeneID (xref) | Resolved for the reviewed/primary entry in 10 of 11 genes. Pogona TP53: NO xref, although NCBI has gene 110087754 for the same symbol. A symbol-only match, so NOT accepted as a link |
| NCBI -> UniProt (`swiss_prot_accessions`) | Only lists reviewed Swiss-Prot entries. Present for TP53, Trp53, tp53, TTN, PTGS1; missing for lacZ, GAL4, FLC, wg, rbcL (no reviewed back-link listed, though UniProt side links) |
| One gene -> many UniProt entries | Common: TP53 10+ hits (1 reviewed), mouse Trp53 10+, zebrafish tp53 8, FLC 10+, TTN 10+. Many are unreviewed TrEMBL fragments/clones |
| One UniProt entry -> many genes | NOT observed in this set |
| Symbol collision | NCBI symbol search for `TTN` returned TTR too (alias hit); `COX1` -> PTGS1 |
| Organelle | rbcL: NCBI gene 844754, plastid (`NC_000932.1`, `Pltd`), UniProt O03042; no OrthoDB xref |

Rules to write in ALGORITHMS.md:
1. A link is accepted only if a database states an ID of the other database (xref or `swiss_prot_accessions`). Record which DB asserted it. Two-sided agreement = "confirmed"; one-sided = "asserted by X only".
2. Never accept a symbol-only match; show it as "same symbol, not linked by any database" (Pogona case).
3. When several UniProt entries link to one gene, list all, put the reviewed one first, and default to it only if exactly one is reviewed; otherwise require a choice.
4. NCBI symbol lookups may return alias hits (TTR for TTN): filter to exact `symbol` match or show as alias match.
5. Inactive UniProt entries (`entryType: Inactive`) become a typed "obsolete" result with `inactiveReason` and `mergeDemergeTo`.

## Orthology coverage matrix (live)

| Gene | NCBI orthologs | OrthoDB |
|---|---|---|
| TP53 / Trp53 / tp53 | 669 reports each (vertebrates only seen, 1.3 MB) | group `4289813at2759` (Eukaryota, 5952 species) and `7040at9604` (Hominidae) contain TP53; found by searching the UniProt accession |
| GAL4 yeast | 23 (fungi) | UniProt xref group ID returns null |
| wg fly | 342 (insects) | UniProt xref group returns null |
| TTN human | 520 | xref null |
| COX1 (PTGS1) | 544 | xref null |
| lacZ E. coli | 1 (itself only) | `9758603at2` Bacteria, 17,551 species: works |
| FLC, rbcL Arabidopsis | 1 each (itself only) | FLC xref null; rbcL none |

Takeaways:
- NCBI covers vertebrates, insects and fungi, but returns only the query gene for plants and bacteria. So the "no human ortholog" and "no bacterial orthologs" cases are real gaps in NCBI.
- OrthoDB's group IDs stored in UniProt's xref are stale for eukaryotes (null on the v12 API), but a v12 search by UniProt accession returns groups that really contain the gene. OrthoDB gene IDs include NCBI GeneIDs (e.g. `7157`), which gives link evidence.
- Recommendation: add OrthoDB as the third source. Resolve groups by searching the UniProt accession, then verify membership by GeneID/UniProt before showing anything. Groups are per taxonomic level, so the UI picks a level (default: a documented one) and shows which. Payloads can be 7 MB, so always filter `species=`.
- Ensembl: not verified (see Blockers). Keep it out of Milestone B unless it becomes reachable.

## AlphaFold specifics (live)

- Data access: GET only (HEAD returns 403). A User-Agent is REQUIRED (403 without one, with Node's and curl's defaults). Our `GeneExplorer/<version>` works.
- Files: use `pdbUrl`/`cifUrl` from the API response (only the latest version, v6, exists at `/files`; v4 is 404). `plddtDocUrl` gives per-residue pLDDT.
- pLDDT is in the PDB B-factor column: TP53 mean over 393 CA atoms = 75.05, API `globalMetricValue` = 75.06 (rounding). Confirmed.
- Titin (Q8WZ42): API 404, files 403 (no model under this accession). Large-protein fragment handling remains unverified; the UI shows "no model" with the reason.
- Species `A0ABM5EJF4`, `F4KFH3`: 404 for some unreviewed entries; show the reason.

## Algorithm review

- Gap convention: use Biopython's PairwiseAligner convention, a gap of length k costs `open + (k-1)*extend`. Default open = -11, extend = -1. Note BLAST's "11/1" is `open + k*extend`, which equals Biopython open = -12, extend = -1; document this and expose both in the UI text. Set end-gap scores explicitly (global alignment, end gaps penalized like internal gaps) so the Biopython cross-check matches.
- Scores are integers, so DP matrices can be Int32Array (4 bytes) instead of the prompt's Float64Array: half the memory with no loss. Proposed cap: m*n <= 4,000,000 cells (about 2000x2000): 3 Int32 matrices = 48 MB plus 4 MB traceback. Titin-size proteins are refused with a friendly message.
- Ambiguity: use matrix values for B, Z, X, *; map U and O to X; reject other letters.
- Tie-breaking: deterministic order diag > up > left.
- Identity: show identities / aligned columns excluding gaps as the headline, and identities / total alignment length in the tooltip; label both.
- Kabsch/Horn: Horn's quaternion method (4x4 symmetric eigenproblem, hand-written Jacobi) never produces a reflection, so no determinant fix needed. If SVD-based Kabsch is used instead, correct with d = sign(det(V*U^T)). RMSD = sqrt(sum |R*a_i + t - b_i|^2 / N).
- Prompt statement that needs a condition: "RMSD between predictions" is only meaningful after the alignment-based residue mapping; also the pLDDT threshold must apply to both models (already in prompt).

## BLOSUM62

NCBI FTP `blast/matrices/BLOSUM62` (24x24: 20 amino acids, B, Z, X, *) compared with Biopython 1.86's bundled matrix: 576 cells compared, 0 differences. Ran and passed. License note for the matrix source is still to be recorded in DATA-SOURCES.md. Biopython installed in `scratch/venv` (1.86 from a wheel; 1.88 failed to build from source on this Mac, so the pin in `tools/requirements.txt` must be 1.86 or a version with wheels).

## Terms (quoted from live pages)

- NCBI: "Information that is created by or for the US government on this site is within the public domain." and "It is the responsibility of the user to examine the copyright and licensing restrictions of linked pages and to secure all necessary permissions."
- UniProt and OrthoDB: pages reference CC BY 4.0 (`creativecommons.org/licenses/by/4.0/`). Full sentences still to quote for DATA-SOURCES.md.
- AlphaFold DB: terms page text not extracted by my scrape; CC BY 4.0 and non-clinical use are leads only, NOT confirmed this session.
- Ensembl: not checked.

## Tooling spike (ran and passed, macOS arm/x64 local)

Minimal app in `scratch/spike` (esbuild, not electron-vite): Electron 45.3.4, app:// privileged protocol with CSP `default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'`.
- Sandboxed, context-isolated TypeScript preload bundled by esbuild to a single CJS file: worked (`window.api.ping()` returned `pong`; `require` undefined in the renderer).
- 3Dmol 2.5.5 bundled via npm: rendered a cartoon colored by B-factor and exported a PNG (15 KB), with no `unsafe-eval` in the CSP.
- `new Function` blocked by CSP (good); `fetch('https://example.com')` blocked by CSP (good).
- Module Web Worker under `worker-src 'self'`: worked.
- `webContents.printToPDF`: produced a 16 KB PDF.
- NOT tested: electron-vite itself, TypeScript 7 with typescript-eslint, electron-builder, path-traversal rejection (my test URL errored for the wrong reason, so it proves nothing), Windows/Linux.
- Decision: because everything works with esbuild and I have not tested electron-vite, I propose Vite (renderer) + esbuild (main/preload). electron-vite 6 supports Vite 8 per its peer deps and is active, so it is a valid alternative; I'd test it at the start of Phase 2 if you prefer it.

## Proposed cache and TTLs

Total cap 500 MB, LRU eviction, entries over 25 MB not cached (except structure files, up to 50 MB).
- UniProt entries/search: 7 days / 1 day (search)
- NCBI gene reports and taxonomy: 7 days; orthologs: 7 days (stored filtered by taxon)
- OrthoDB groups/orthologs: 14 days
- AlphaFold JSON: 30 days; structure files (versioned URLs): 90 days
- Taxonomy autocomplete: 30 days
Offline mode serves entries past TTL with a banner.

Rate limits (stay under): NCBI 3 req/s without a key (published 5/s, observed header), UniProt 5 req/s (no published limit found; conservative), AlphaFold 5 req/s (unpublished), OrthoDB 2 req/s (unpublished, some calls take 5 s).

## Still open / Blockers

- `rest.ensembl.org`: unreachable from this network (not retested). Skipped by your decision.
- `tools/record-fixtures.ts`: not written yet; I'd write it in Phase 2/3 since it needs the TypeScript toolchain.
- Not yet verified: UniProt terms sentence for DATA-SOURCES.md, AlphaFold terms sentence, mouse/zebrafish/fly/yeast structure files, an annotation-quality field in NCBI reports (no "automatic only" flag found; I'd derive it from UniProt reviewed status and NCBI annotation name, labeled as such).
