# Working on Pulseboard (Codex adapter)

`CLAUDE.md` is the canon for every agent runtime: what the two runtimes are, how to run and prove
each seam, the map, the pitfalls and the authority (T2, `.agent-harness/tier.json`,
`HUMAN_TODO.md`). Read it first; this file only carries what Codex needs beyond it.

- Start with `scripts/agent/context.ps1`; use `scripts/agent/check.ps1` for the Desk and harness
  proving checks. On Windows invoke scripts with `powershell -NoProfile -ExecutionPolicy Bypass -File`.
- The shared Codex guidance, skills and custom roles come from sibling `claude-config/codex/`
  via `agent-harness/harness.py sync-global`. Do not copy global skills or MCP servers into this repo.
- `.codex/hooks.json` uses the canonical shared adapter. Its expected hash is an audit marker,
  not runtime verification. In a new session at this checkout, inspect `/hooks` and trust the
  reviewed adapter. Static doctor output cannot prove session activation.
- Use `codex.cmd`, `npm.cmd` and `npx.cmd` on Windows; the unsigned `codex.ps1` shim is blocked
  by this machine's policy. The shared doctor's bare `codex` probe currently hits that shim.

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
