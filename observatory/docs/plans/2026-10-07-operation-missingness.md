# Versioned operation missingness: design and implementation plan

**Goal:** Show every unpaired terminal as missing evidence rather than silently dropping it, without changing existing portfolio consumers or collection.

**Architecture:** Keep `/v1/portfolio` and `readPortfolio` at version 2 by default. Explicit `version=3` returns `pulseboard.portfolio/3`; registered operation vocabulary remains version 1. Version 3 adds closed `unmatched: {completed, failed}` counts to each operation and release. First-terminal pairing, retries and completion denominators stay unchanged. Version 2 filters terminal-only release rows and omits the new fields. The Desk opts into v3 only after its validator accepts both versions.

**Trade-off:** A side endpoint would need a separate network state machine and inconsistent snapshot times; an unversioned extra field would break strict readers. Version negotiation keeps one transactional read and allows old producers/readers to remain on v2. Missing v3 detail on a v2 response is unavailable, never assumed zero.

**Meaning:** An unmatched terminal is any admitted completed/failed event not consumed by strict session/route/release/sequence/window pairing. It includes no prior in-window start, later terminals after resolution, ties and route/release mismatches. Counts cannot attribute a cause or prove a user's action failed. Raw events and identities are not exposed. Observed terminals equal paired plus unmatched terminals of each kind, including terminal-only releases. Storage-order ties keep the documented caveat from #208.

**Technology:** Native Node 22.16+, SQLite/D1-compatible grouped/window SQL; native browser modules and existing HTML controls. No new dependencies, tables, endpoints, collector events, admission lists or background calls.

## Global constraints

Keep schema 5 and every owner decision unchanged. No hosted resource creation, historical cleanup execution, token change or new probe target. Existing approved main-triggered deployment remains in effect. Legacy workbench stays frozen. Public pulse export must exclude all operation evidence. Handoffs remain unsigned review proposals, never execution authority.

## Review focus

Terminal-only releases must survive folding; v2 must remain byte-shape compatible. Duplicate sequences must never consume a terminal twice. Fake negative, overflowing, omitted or inconsistent v3 counts must fail validation. An older v2 collector must not look like zero missingness. Failed refresh and synthetic modes must retain those markings through the drawer and handoff.

## Task 1: Versioned read contract and query

Files: `src/operations.mjs`, `src/portfolio.mjs`, `src/worker.mjs`, `public/desk-bridge.mjs`, `tests/operation-missingness.test.mjs`, `docs/NAMED_OPERATIONS.md`.

Produces: `readPortfolio(db, {version: 2|3 = 2, ...})`; `GET /v1/portfolio?version=3&days=7`; dual-version `assertPortfolio`. All other read fields unchanged.

- [x] Write real SQLite and handler regressions: v3 shape, unmatched causes, first terminal, ties, partitions, receipt bounds, folded release reconciliation and v2 compatibility.
- [x] Observe failures on existing code; save the output.
- [x] Count all terminal kinds in the existing grouped query and subtract only paired starts. Do not add correlated scans.
- [x] Negotiate exactly 2 or 3 after authentication, reject duplicate/unsupported version parameters before database reads.
- [x] Validate exact unmatched keys, nonnegative safe integers, event ceilings and whole/release reconciliation in v3; retain v2 strict operation shape.
- [x] Run focused tests and seeded reference oracle; v2 profiler remains bounded with no correlated scans.
- [ ] Final full suite and whitespace, draft publication, separate review and exact-head hosted gates before merge.

## Task 2: Missingness in the Desk and reviewed handoff

Files: `public/desk-network.mjs`, `public/dashboard.mjs`, `public/desk-model.mjs`, `public/desk-demo.mjs`, focused unit/browser tests and `.github/workflows/desk-browser.yml` only to run the new browser gate.

Consumes Task 1: mandatory v3 `unmatched` fields; v2 absence is unavailable. Adds no other network request.

- [ ] Write failing request/decision-model tests and a real-server browser regression covering v3 drawer, old v2 response, demo, stale evidence and handoff boundaries.
- [ ] Opt the Desk request into v3, display per-operation and bounded release counts, and surface an unmatched-evidence next check with versioned rule provenance.
- [ ] Include a deterministic synthetic missingness example; keep all demo activity in memory.
- [ ] Prove exact reviewed handoff bytes, stable identity, no implicit imports, no operation data in public pulse and no low-sample failure diagnosis.
- [ ] Full suite, browser gate, separate review and exact-head CI. Keep #73 open for independent current-host hook qualification.

## Progress

Baseline main `32d2a6f1` / tree `aef6991f702d24f40ffa67c2421aef942eeaf4b6` reconstructed and matched exactly; 715 tests passed with no skips. Implementation runs inline in the disposable local workspace, with GitHub-native publication. No independent subagent review is available.

Task 1 local evidence: 40 initial semantic failures; after implementation all 56 direct/oracle cases pass. The public exporter had a separate v2-only guard; its existing projection is retained after validating v3.
