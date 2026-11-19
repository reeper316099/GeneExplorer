# Algorithms and rules

How GeneExplorer decides things. Everything here is implemented in the code paths named in each heading, and the alignment and superposition maths were written from scratch and checked against Biopython.

## 1. Identity: which gene and protein are "the same"

- Input is classified first (`src/core/search.ts`): NCBI Gene ID, UniProt accession or isoform, RefSeq accession, HGNC ID, Ensembl ID, OrthoDB group, a single gene-symbol-like word, or free text. Only the first four kinds and symbol-plus-species are searchable; Ensembl, HGNC, OrthoDB-group and free-text input get a clear "not searchable yet" message. Input is Unicode-normalised, control characters are stripped, and it is capped at 100 characters.
- A symbol is **never** an identity. A bare symbol needs a species (symbols repeat across species and collide with aliases; human `COX1` is an alias of `PTGS1`, while the mitochondrial gene is `MT-CO1`). The species is looked up in NCBI's taxonomy by name.
- **Ranking rule:** among genes NCBI returns for a symbol and species, only an _exact_ symbol match (case-insensitive) is selected automatically, and only if exactly one gene matches. Alias-only matches are shown as choices, never used silently. Several exact matches, or none, produce a "pick one" list.
- A gene (NCBI) and a protein (UniProt) are linked **only through database cross-references** (`src/core/identity.ts`): `confirmed` = each points at the other; `one_way` = one points at the other (NCBI lists only reviewed UniProt entries, so this is normal for unreviewed ones); `conflict` = they point at different records; `unconfirmed` = no link either way, which the UI says plainly. For non-vertebrates NCBI often lists no UniProt entry, so UniProt is searched by its own `GeneID` cross-reference (`src/core/resolve.ts`).
- Taxon check: same taxon, ancestor (e.g. UniProt uses the species while NCBI uses a strain), or different. A different organism is flagged.
- **Obsolete IDs:** UniProt answers HTTP 200 with `entryType: "Inactive"` for deleted or demerged accessions. The app shows the reason and the replacement accessions, not an error.

## 2. Canonical choices

- **Protein isoform** (`src/core/isoforms.ts`): UniProt's displayed entry sequence is the canonical isoform. Other isoforms are listed and fetched only when the user switches; it never switches by itself.
- **Transcript** (`src/core/gene-view.ts`): MANE Select, else RefSeq Select, else the longest. The label shows which rule applied.
- **Genome annotation:** when NCBI returns several annotations (e.g. human GRCh38.p14 and T2T-CHM13) the app picks one and says which.
- **Ortholog group** (`src/core/ortholog-state.ts`): the broadest OrthoDB group with at most 1,500 genes, otherwise the smallest. The user can pick any group.
- **Orthologs:** NCBI and OrthoDB are fetched, stored and shown separately and are never merged. When a source has no ortholog for a species the app says "none in this source", not "none exist".

## 3. Global alignment: `src/bio/align.ts`

- Needleman–Wunsch with affine gaps (Gotoh 1982): three integer tables (pair, gap in B, gap in A), BLOSUM62.
- Gap of length k costs `open + (k-1) * extend`; defaults open −11, extend −1 (same convention as Biopython `PairwiseAligner`).
- End gaps are penalised like internal gaps (true global alignment).
- Ties are broken diagonal > gap-in-B > gap-in-A, so results are deterministic. When several alignments score the same, **which one is shown is arbitrary**; the score is not.
- Memory guard: refuses inputs over 4,000,000 cells (about 2000 × 2000 residues) with a clear message instead of freezing.
- Rare letters (U, O, J) score as X. Sequences with digits or symbols are rejected.
- Identity is reported three ways: over aligned columns (headline), over all columns, and over the shorter sequence.
- **Checked by:** 38 Biopython 1.86 reference cases (12 real UniProt pairs, synthetic mutated/unrelated pairs, edge cases, custom gap costs): score must match exactly, and where Biopython finds exactly one optimal alignment ours must be identical; exhaustive brute force on tiny inputs; property tests (symmetry, strip-back to input, re-scoring, ordering).

## Superposition — `src/bio/superpose.ts`

- Horn (1987) quaternion method (equivalent to Kabsch): centre both sets, build the 4×4 matrix from the covariance, take the eigenvector of the largest eigenvalue (Jacobi iterations), convert to a rotation matrix.
- Always a proper rotation (determinant +1); a mirror image is never produced, so handedness is preserved.
- Needs ≥ 3 point pairs. RMSD is computed directly from the moved points.
- **Checked by:** 17 Biopython `SVDSuperimposer` reference cases (noisy, unrelated, planar, helix-like, mirror image): RMSD agrees to 6 decimals; rotation/translation agree where unique; property tests (orthonormal, det +1, recovers a known rigid motion, never worse than no superposition, symmetric).

## Structure reading — `src/bio/pdb.ts`

- One C-alpha per residue from fixed-column ATOM records; AlphaFold pLDDT is read from the B-factor column. Checked: mean B-factor equals AlphaFold's reported mean pLDDT for the same model (insulin).

## BLOSUM62 — `src/bio/blosum62.ts`

- Generated by `tools/gen_blosum.py` from Biopython's copy; verified in Phase 1 to match the NCBI file in all 576 cells.

## Regenerating references

```bash
scratch/venv/bin/python tools/gen_align_refs.py
scratch/venv/bin/python tools/gen_superpose_refs.py
```

(needs `tools/requirements.txt`; the alignment generator downloads sequences from UniProt).

## 4. Identity numbers, low-identity warning and overlay rules

- Identity is reported over aligned columns (headline), over all columns, and over the shorter sequence (`src/core/compare.ts`). The three are never mixed.
- A pair below 30% identity gets a warning that the alignment is weak (TP53 against _E. coli_ lacZ aligned at 28.8%, which is why the line sits there).
- A structure overlay (`src/core/overlay.ts`) uses only residue pairs that the alignment matched, needs at least 10 pairs and at least 30% identity, and states the number of pairs used. RMSD is the average distance between matched C-alpha atoms after the best rigid fit. It says how close the matched backbone atoms are; it does not say the proteins are functionally the same, and it depends on which residues were matched. There is no per-domain superposition.

## 5. pLDDT

AlphaFold stores a per-residue confidence (pLDDT, 0 to 100) in the B-factor column. Bands used for colour: very high above 90, confident above 70, low above 50, very low 50 or below. Low-confidence regions are often flexible or disordered. A permanent note says structures are predictions, not clinical evidence.

## 6. Network, cache and rate-limit design

- The UI (renderer) makes no network requests; it asks the main process through typed IPC. The main-process net layer (`electron/net.ts`) allows only the hosts in `electron/allowlist.ts`.
- **Per-host token bucket:** UniProt 5/s, NCBI 3/s, AlphaFold 5/s, OrthoDB 2/s (conservative; each host has its own bucket and concurrency cap).
- **In-flight de-duplication:** identical requests share one fetch. **Cancellation:** each search or view owns a scope; leaving it aborts its requests.
- **Retries:** GET only, up to 3, exponential backoff with jitter; `Retry-After` is honoured, and while a host says to wait nothing is sent to it. A wait longer than 60 s fails with a clear message instead of freezing.
- **Disk cache** (`electron/cache.ts`): one JSON file per request, TTL per host (UniProt and NCBI 7 days, OrthoDB 14, AlphaFold 30), 500 MB cap with least-recently-used eviction, and a SHA-256 integrity hash checked on read. Stale entries are used only when the network or server fails (offline, timeout, server error, rate limit), and are labelled with their fetch time.
- **Size and time limits:** response size caps and timeouts per request. Every response is validated with zod before use; an unexpected shape becomes a labelled error, not a crash.
- **User-Agent:** generic `GeneExplorer/<version>` only.
