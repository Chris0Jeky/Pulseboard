# Working on Pulseboard

The primary product direction is now the operations Desk in `observatory/`.
Read `observatory/docs/DESK_ARCHITECTURE.md` and `DESK_BRIDGES.md` before changing
measurement or data boundaries. The FastAPI / Vue workbench remains separate;
its existing guidance in `CLAUDE.md` and `WORKBENCH.md` still applies to that code.

Run `cd observatory && npm test`. Browser changes also need
`tests/desk-browser.py` against the real local server. The explicit offline mode
is useful in restricted environments but does not verify HTTP serving or CSP.
Keep the existing kit suite intact. Do not use a successful Desk gate to claim
that legacy workbench issues #13 and #14 have been repaired.

Collection is disabled by default. Do not enable collection, merge dependent PRs,
deploy Workers, broaden probe targets or publish private projections as incidental
cleanup. Review-only exports must stay review-only. Imported claims never become
verified CI, user identity, public project health or causality by relabelling.

Use closed, versioned contracts, bounded payloads, explicit missingness and source
times. Preserve denominator meaning. Never average percentiles. Keep demo fixtures
out of collector storage. Prefer a tested vertical slice to speculative scaffolding.
