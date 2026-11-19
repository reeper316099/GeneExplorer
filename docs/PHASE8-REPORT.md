# Phase 8 report: packaging and GitHub automation

Date: 2026-11-19. Status words: **RAN and PASSED**, **RAN and FAILED**, **NOT RUN**.

## What was built

| Item | File | Status |
| --- | --- | --- |
| Packaging config (Windows NSIS + portable x64, macOS dmg arm64 + x64, Linux AppImage + deb x64, GitHub publish, artifact names with version/OS/arch) | `electron-builder.yml` | config validated (YAML parses); macOS `--dir` build RAN and PASSED; installer targets NOT RUN locally |
| App icon (DNA helix) | `build/icon.svg`, `build/icon.png` (1024x1024); electron-builder derives .ico/.icns | PNG rendered; .ico/.icns generation NOT RUN (only `--dir` was built) |
| CI workflow | `.github/workflows/ci.yml` | NOT RUN (needs GitHub) |
| Release workflow | `.github/workflows/release.yml` | NOT RUN (needs a pushed tag) |
| Package check script | `scripts/verify-package.mjs` | RAN and PASSED on the real package; negative test (dev build) RAN and correctly FAILED it |
| README with unsigned-build steps, licence file | `README.md`, `LICENSE` | written |

No Pages workflow and no scheduled-refresh workflow exist. Workflows use only `actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4`, `download-artifact@v4` (official, pinned to major versions) and the built-in `GITHUB_TOKEN` (`contents: write` only in release.yml; ci.yml is read-only).

## Findings and fixes

1. **Build outputs were committed.** `dist-electron/*` was in the first commits. Untracked it (`git rm --cached`) and added `dist-electron/`, `release/`, `coverage/` to `.gitignore`. Needs your commit.
2. **The package shipped all of node_modules (260 MB, thousands of test files from zod).** Main, preload and renderer are fully bundled, so `zod` and `3dmol` were moved from `dependencies` to `devDependencies`. The package is now 11 files, `app.asar` 1.5 MB, app 260 MB (almost all Electron itself).
3. **Test-mode code is not in the package.** RAN and PASSED: none of `GENEEXPLORER_TEST_MODE`, `_BACKGROUND`, `_TEST_SAVE_DIR`, `_TEST_RATELIMIT`, `createFixtureFetch`, no fixtures, no source maps, no test files. A dev build fed to the same script fails it, so the check does detect them.
4. The packaged app can only ignore test-mode env vars because the code is gone; a runtime check of that (launching the packaged app with the flag) is **NOT RUN** locally, to avoid popping a window over your work.

## Checks run locally (macOS, Apple Silicon)

- ESLint, `tsc` (4 configs), Prettier: RAN and PASSED. 271 unit tests: RAN and PASSED.
- `electron-builder --dir --mac --arm64`: RAN and PASSED (unsigned, code signing skipped as configured).
- Build warnings seen: Vite chunk size over 500 kB (3Dmol, lazy-loaded) and the known 3Dmol `eval` in an unused path. The strict CSP has no `unsafe-eval`, so that path cannot run.

## Not tested, and why

- Linux packaging, the packaged app under xvfb, Windows and the macOS dmg/universal build: CI-only, per your decision. **UNTESTED LOCALLY, verified only by CI.**
- The CI Electron e2e on Ubuntu: the sandbox needs `kernel.apparmor_restrict_unprivileged_userns=0` on Ubuntu 24.04 runners, which the workflow sets. This is the likeliest first-run failure; if CI fails there, that is where to look.
- Packaged app launch, load a gene, show a structure, export a PDF: **NOT RUN** (see checklist).
- Auto-update, code signing and notarization: not implemented (stretch list).

## Manual click-through checklist (after the first release)

Do on each OS you have. Check `SHA256SUMS` first.

1. Download the installer; `shasum -a 256 <file>` (macOS/Linux) or `Get-FileHash <file>` (Windows) matches `SHA256SUMS`.
2. Install and open, following the README unsigned-app steps. App opens with the GeneExplorer window, no console errors.
3. Search `TP53`, human. Overview, Location and Protein tabs fill in; the 3D structure appears and rotates; pLDDT legend and the "prediction" note show.
4. Species tab loads orthologs (NCBI and OrthoDB separately).
5. Compare TP53 with mouse Trp53: alignment, identity and overlay show.
6. Export JSON, CSV, and the PDF report; open the PDF.
7. Turn off the internet and search a gene you viewed before: cached data shows with its fetch time; a new gene gives a clear error, not a crash.
8. Click an external link in About: opens in your browser only for an allowlisted https site.
9. Quit and reopen: theme and favorites are remembered.
10. Release page lists: Windows installer + portable, two macOS dmgs, AppImage, deb, and `SHA256SUMS`.

## To release

```bash
git tag v0.1.0 && git push origin v0.1.0
```
