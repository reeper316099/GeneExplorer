# Changelog

## v0.1.0 (first release)

First public version of GeneExplorer, a desktop app (Windows, macOS, Linux) for exploring a gene in any species.

### What's new

- **Search by ID or symbol.** Gene symbol plus species, NCBI Gene ID, UniProt accession (including isoforms) or RefSeq accession. Ensembl IDs, HGNC IDs, OrthoDB group IDs and free-text name search are recognised but not searchable yet; the app says so. Symbols are never trusted as identity: genes and proteins are linked only through database cross-references, and the app says when a link is confirmed, one-way, conflicting or unconfirmed. Obsolete UniProt accessions show what replaced them.
- **Gene page with five tabs.** Overview, Location (chromosome map and exon structure), Protein and Structure (UniProt feature track and an AlphaFold 3D structure coloured by pLDDT confidence), Species (orthologs) and Compare.
- **Orthologs from two sources, shown separately.** NCBI and OrthoDB are never merged. Filter, sort and group by clade; export CSV. Missing data says "not available".
- **Compare two genes.** Field-by-field table, global protein alignment (own affine-gap implementation, run in a worker), identity windows, FASTA and CSV export, and a 3D structure overlay with RMSD and the number of residue pairs used.
- **Reports and exports.** JSON, CSV, FASTA and a printable PDF report. Every fact lists its source database, record ID and fetch time.
- **Honest science built in.** Standing "prediction, not clinical" note on structures, reviewed versus unreviewed UniProt entries, canonical isoform with a manual switch, and an educational-use disclaimer.
- **Polite and private.** Per-host rate limits, request de-duplication, disk cache with expiry, back-off that honours `Retry-After`, cancellation, and a generic User-Agent. No accounts, no API keys, no tracking.
- **Secure by design.** Sandboxed window with context isolation and a strict Content-Security-Policy; all network access happens in the main process against an allowlist; navigation and new windows are blocked; links open only for allowlisted https sites.
- **Light and dark themes**, keyboard-accessible feature tracks, minimum window 1200x760.

### Checked

- 271 unit and property tests, 58 live contract checks against the real servers, 41 end-to-end tests in the real Electron app (recorded fixtures).
- Alignment scores match Biopython exactly on 8 protein pairs; superposition RMSD agrees to better than 1e-15 angstrom on 4 structure pairs.
- 76 spot-checks against independent sources (NCBI E-utilities, UniProt FASTA, AlphaFold files, Alliance of Genome Resources): 0 failures.

### Known limits

- Windows and macOS installers are **unsigned**; your OS will warn you (see README). No auto-update.
- Ensembl is not used (and Ensembl IDs cannot be searched). NCBI lists at most one ortholog per species, so a one-to-many pick flow is covered by logic tests only.
- No per-domain superposition. The PDF layout was checked by text extraction, not by viewing a rendered PDF.
- Only macOS (development run) was exercised by hand; Windows and Linux builds are verified by CI only.
