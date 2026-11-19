# Phase 9 report: deliverables

Date: 2026-11-19.

## Delivered

| Deliverable | Where | Notes |
| --- | --- | --- |
| README (pitch, screenshots, downloads, features, how it works diagram, honest-science notes, validation numbers, run instructions, unsigned-app steps, security, limitations, publish steps, ranked stretch features) | `README.md` | "What I learned" is a marked TODO for you to write, as requested |
| Algorithms and rules write-up | `ALGORITHMS.md` (moved from `docs/`) | identity, ranking, canonical choices, aligner, superposition, pLDDT, cache and rate limits |
| Data sources, licences, citations | `DATA-SOURCES.md` | licence sentences quoted from the real pages/files, accessed 2026-11-19 |
| Licence | `LICENSE` (MIT) | plus a data-belongs-to-providers statement |
| Changelog | `CHANGELOG.md` (v0.1.0) | |
| Interview talking points | `INTERVIEW.md` (10) | |
| Git/GitHub steps | `README.md`, "Publish it" | |
| Stretch features, ranked | `README.md` | |

## Found and fixed

- **Licence wording verified.** UniProt (CC BY 4.0, quoted from its licence help text), OrthoDB (CC-BY-4.0, from the site's machine-readable description), NCBI (public domain sentence quoted), AlphaFold (CC-BY 4.0, quoted from the REMARK header of a downloaded model; the terms web page itself needs JavaScript and could not be read). The About page no longer says the AlphaFold licence is unconfirmed, and its OrthoDB row no longer says "not used yet" (it was stale).
- **Search limits stated honestly.** Ensembl IDs, HGNC IDs, OrthoDB group IDs and free-text name search are recognised but not searchable yet (the app says so). Docs now say this.
- UI heading "Structure overlay (Milestone C)" renamed to "Structure overlay".
- **A flaky e2e test** ("dark mode persists across app restarts") failed about 1 run in 8: the test read the theme before the relaunched page had finished starting. The app was fine (a script doing the full quit and relaunch 14 times, waiting for the page, passed every time, and the preference file was on disk each time). Fixed the test helper to wait for the page; the test then passed 20 of 20 runs. An extra quit-delay I tried first did not help and was reverted.

## Final checks (all run 2026-11-19, macOS)

- ESLint, TypeScript (4 configs), Prettier: clean. Zero `any`, no TODO/FIXME/placeholder text in `src`, `electron`, `scripts`, `tools` (the only TODO is the README "What I learned" slot you asked for).
- 271 unit/property tests passed; 41 end-to-end tests passed (recorded fixtures, hidden window).
- Production build has 0 test-mode markers.
- `npm audit`: 0 vulnerabilities in shipped dependencies; 6 moderate in dev tooling (electron-builder's `minimatch`), fix needs a breaking upgrade, not applied.
- Live contract checks and the live smoke test were not re-run this phase (last run 2026-11-18, Phase 7).

## Still not verified

CI and release workflows, Linux/Windows installers, the macOS dmg, a launch of the packaged app, and rendering of the PDF were not run (see Phase 8 report and the checklist there).
