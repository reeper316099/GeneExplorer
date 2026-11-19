# GeneExplorer

A desktop app (Electron + TypeScript) for exploring a gene in any species: what it is, where it sits in the genome, its protein and AlphaFold 3D structure, its orthologs (the same gene in other species), and side-by-side comparison of two genes with a structure overlay.

**Educational use only.** This is not a medical or clinical tool. AlphaFold structures are computer predictions, and orthology is inferred, not measured.

## What it does

- Search by symbol, gene ID, UniProt accession or free text, with a species picker.
- Gene overview, genome location and exon structure, protein features, AlphaFold 3D structure coloured by confidence (pLDDT).
- Orthologs from NCBI and from OrthoDB, shown separately (never merged), grouped by clade.
- Compare two genes: field-by-field table, global protein alignment, identity windows, and a 3D structure overlay.
- Export JSON, CSV, FASTA and a printable PDF report. Every fact shows its source, record ID and fetch time. Missing data says "not available"; nothing is estimated.

Data comes live from UniProt, NCBI Datasets, AlphaFold DB and OrthoDB. No API keys, no accounts. The app is polite to those servers (rate limits, caching, back-off) and sends only a generic `GeneExplorer/<version>` User-Agent. See the in-app **About & limits** page for sources, licences and known gaps.

## Install

Download an installer from the [Releases page](https://github.com/reeper316099/GeneExplorer/releases) and check it against `SHA256SUMS` on the same page.

| OS      | File                                           |
| ------- | ---------------------------------------------- |
| Windows | `.exe` installer or portable `.exe` (x64)      |
| macOS   | `.dmg` (Apple Silicon `arm64`, or Intel `x64`) |
| Linux   | `.AppImage` or `.deb` (x64)                    |

### Honest limits of the builds

- **Windows and macOS builds are UNSIGNED.** Signing needs paid certificates, which this project does not use. Your OS will warn you; that is expected for an unsigned app, not proof of a problem. Compare the file's SHA-256 with `SHA256SUMS` first.
  - **Windows (SmartScreen):** "Windows protected your PC" → click **More info** → **Run anyway**.
  - **macOS (Gatekeeper):** open the `.dmg`, drag the app to Applications. If it says it "can't be opened" or is "damaged", right-click the app → **Open** → **Open**. If that is not offered, run `xattr -dr com.apple.quarantine /Applications/GeneExplorer.app` once in Terminal (it removes the download quarantine flag from this one app).
  - **Linux:** `chmod +x GeneExplorer-*.AppImage` then run it, or `sudo apt install ./GeneExplorer-*.deb`.
- **No auto-update.** Download new versions manually.
- Release builds are produced by GitHub Actions. Only macOS (a development run on Apple Silicon) has been exercised by hand so far; the Windows and Linux installers are built and tested by CI only. See `docs/PHASE8-REPORT.md` for exactly what was and was not run.
- Needs an internet connection for data. Previously viewed genes are cached on disk for a limited time.

## Develop

Requires Node 22 and npm.

```bash
npm ci
npm run dev          # build + run the app with live rebuilds
npm run lint && npm run typecheck && npm run format:check
npm test             # unit + property tests (offline)
npm run test:e2e     # Electron end-to-end tests, answered from recorded fixtures (hidden window)
npm run test:contract  # checks the real servers still match our parsers (needs internet)
npm run pack         # unpacked app in release/ (local check)
npm run verify:package -- <path to app.asar>   # proves test-mode code is not in the package
```

Tests never need the network except `test:contract` and `smoke:live`. Layout: `src/api` (clients and zod schemas), `src/bio` (alignment and structure maths, written from scratch and cross-checked against Biopython), `src/core` (logic), `src/ui` (vanilla TypeScript UI), `electron` (secure main process and network layer), `docs/` (algorithms and per-phase reports).

## Security model

The window runs with context isolation, no Node integration, sandbox, and a strict Content-Security-Policy. The UI makes no network requests at all; the main process fetches from an allowlist of hosts. Navigation and new windows are blocked; external links open only if they are `https` on an allowlist.

## Releasing

Push a tag like `v0.1.0`. `.github/workflows/release.yml` builds on Linux, Windows and macOS, attaches installers to a GitHub Release and adds `SHA256SUMS`. CI (`ci.yml`) runs lint, typecheck, tests and the Electron e2e suite on every pull request and push to `main`.

## Licence

MIT, see `LICENSE`. Third-party data keeps its own licences (listed in the app's About page).
