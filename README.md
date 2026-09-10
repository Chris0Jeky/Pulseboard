# Pulseboard

<img src="observatory/public/mark.svg" width="54" height="54" alt="Pulseboard mark">

**A small operations desk for everything you ship.**

Pulseboard brings product usage, synthetic checks, release cohorts and development
context into a compact workspace. See what needs a look, inspect the evidence,
and leave with a useful next step. Missing data stays missing. Nothing deploys,
pages someone or starts collecting because a chart changed colour.

The Desk is the new primary direction. It builds on the Observatory kit from #15.
The original FastAPI / Vue feed workbench is retained as a separate runtime, not
silently rewritten or presented as migrated.

## Open the desk

Node.js 22.16 or newer is required. The Desk has no external runtime dependencies
and no build step.

```bash
git clone https://github.com/Chris0Jeky/Pulseboard.git
cd Pulseboard/observatory
npm test
npm start
```

Open `http://127.0.0.1:8788`. Choose **Try a scenario** for an invented, interactive
portfolio, or paste the read token printed in your terminal to inspect the local
collector. A clean database has no production evidence. Collection stays disabled.

During review, check out `feat/pulseboard-desk-ui` rather than expecting this new
surface on main. Review and merge the stacked changes in order: #15, #16, then
the Desk UI PR. Retarget each dependent PR to main after its base is merged and
rerun its checks. Do not merge a child into its unmerged feature-branch base.

## What is here

| Surface | What it does |
| --- | --- |
| The desk | Searchable project register, route and release details, UTC receipt charts, local/external boundaries and explicit missingness |
| Signal inbox | Transparent rules with evidence, local acknowledgement, snooze and reviewed task proposals |
| Release lab | Side-by-side failure proportions, sample floors, descriptive Wilson intervals and release-specific p95 duration in the evidence drawer |
| Scenario replay | Four invented situations with before / incident / recovery controls; no collector writes |
| Connections | Protected Observatory reads, native CommitAtlas v2 catalogue import, reviewed Lens-projection reader and selected public probe exports |
| Field notes | Previewed Markdown observations and JSON handoffs, downloaded only after review |

The interface has keyboard navigation, a command palette, density controls,
reduced-motion support and narrow-screen layouts. Aggregate snapshots and tokens
stay in tab memory. Local review state and density preferences can persist in the
browser. Imported context stays separate from operational readings and is cleared
on disconnect.

## The useful split

**Observatory** collects a closed, content-free event vocabulary and synthetic
checks. **Pulseboard** helps interpret those observations and choose the next
check. **Developer Lens** remains the authority for development analysis.
**CommitAtlas** remains the public presentation layer.

The current CommitAtlas bridge reads its existing `projects.json` v2 files.
The Lens reader implements a new explicit projection contract; a native Lens
producer is still a follow-up. Public pulse files are generated here, but an
upstream CommitAtlas consumer is not installed by this PR. Task handoffs are
reviewable files, not automatic task creation.

There is no production tracing backend, automatic GitHub sync, billing dashboard,
longitudinal user identity, incident paging or automatic remediation in this slice.
Those directions have explicit expansion seams rather than pretend integrations.

## Engineering boundaries

`GET /v1/portfolio?days=1|7|14` uses the existing read token and a transactional
SQLite/D1 aggregate projection. It exports no event or session identifiers.
API snapshots and imported files are bounded and validated before they reach the
views. An unavailable collector cannot silently turn into a successful demo.

A failed refresh retains a visibly stale last-good snapshot; an authentication
failure clears private state. Requests have timeouts, cancellation and generation
guards. Hidden tabs pause polling. Assets have a self-only content security policy
and no third-party fonts or scripts. The asset budget is tested at 128 KiB raw /
40 KiB gzip; those are guardrails, not measured network latency claims.

## Documentation

- [Architecture, API and measurement semantics](observatory/docs/DESK_ARCHITECTURE.md)
- [Desk guide and browser test commands](observatory/docs/DESK_GUIDE.md)
- [Ecosystem contracts and integration status](observatory/docs/DESK_BRIDGES.md)
- [Direction, expansion paths and delivery order](observatory/docs/DESK_DIRECTION.md)
- [Original collection activation gates](observatory/README.md)
- [Asset provenance](observatory/docs/DESK_ASSETS.md)

## Existing feed workbench

The previous README is preserved in [WORKBENCH.md](WORKBENCH.md), including its
FastAPI / Vue setup, Docker commands and custom-feed documentation. Those commands
still refer to the legacy workbench, not the new Desk. Historical test counts and
readiness claims in that document are not current verification; its outstanding
quality-gate and packaging debt remains in #13 and #14.

## Licence

GPL-3.0-only. See [LICENSE](LICENSE). The new source, interface and original vector
assets use the repository's existing licence.
