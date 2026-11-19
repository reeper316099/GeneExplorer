# Phase 3 report — data layer and core logic (no UI)

## What exists
| Area | Files |
|---|---|
| Branded IDs, domain records | `src/shared/ids.ts`, `src/shared/domain.ts` |
| zod schema for every response | `src/api/schemas.ts` |
| Parsers → records with provenance | `src/api/parse.ts` |
| URL builders (encode all user text) | `src/api/endpoints.ts` |
| API client over an injected transport | `src/api/client.ts` |
| Search classification, identity, isoforms, lineage, compare, resolver | `src/core/*.ts` |
| Aligner, superposition, PDB reader, BLOSUM62 | `src/bio/*.ts` |
| Reference generators | `tools/gen_*.py`, `tools/requirements.txt` |

## Tests
- 207 unit/property tests pass (11 files); 22 live contract tests pass (`npm run test:contract`); typecheck, ESLint and Prettier clean.
- Parsers are tested on **real recorded responses** (23 fixtures, `tests/fixtures/api/index.json` holds URL + date).
- Six hand-made mutations (wrong gap cost, wrong quaternion term, loose identity rule, symbol misclassified, wrong coverage maths, skipped length check) were each caught by the tests.
- Not measured: line coverage (the coverage plugin is not in the approved stack).

## Honesty rules enforced in code
- Gene ↔ protein link only through cross-references (`checkIdentity`); symbol-only match is `unconfirmed`.
- Alias-only symbol hits (e.g. COX1 → PTGS1) become an "ambiguous: pick one" result, never auto-selected.
- Orthology is "reported" only if a loaded call links the two proteins, and is worded as inferred.
- Obsolete UniProt IDs return their replacements; NCBI HTTP 400 is shown as "not recognised / may be discontinued".
- Unknown lineage → "Unclassified", never guessed.

## Known limits
- Alignment capped at ~2000 × 2000 residues (message shown beyond that).
- OrthoDB gene labels are shown as OrthoDB gives them; they are not treated as NCBI Gene IDs.
- Ensembl, HGNC and OrthoDB-group IDs are classified but not yet searchable.
