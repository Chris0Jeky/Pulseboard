# Working on Pulseboard (Codex adapter)

`CLAUDE.md` is the canon for every agent runtime: what the two runtimes are, how to run and prove
each seam, the map, the pitfalls and the authority (T2, `.agent-harness/tier.json`,
`HUMAN_TODO.md`). Read it first; this file only carries what Codex needs beyond it.

- Desk changes: `cd observatory && npm test`, and for browser changes `tests/desk-browser.py`
  against the real local server (the offline mode does not verify HTTP serving or CSP).
- Do not enable collection, deploy Workers, broaden probe targets or publish private projections
  as incidental cleanup. Review-only exports stay review-only. Imported claims never become
  verified CI, user identity, public project health or causality by relabelling.
- Closed versioned contracts, bounded payloads, explicit missingness and source times; never
  average percentiles; demo fixtures never reach collector storage; a tested vertical slice
  beats scaffolding. A green Desk gate never closes the workbench debt in #13 and #14.
- Codex-specific: paths in `CLAUDE.md` are Windows (`venv/Scripts/python`); on Linux use
  `venv/bin/python`. Codex cloud has no Playwright browser unless installed as above.
