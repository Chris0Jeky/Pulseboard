# Pulseboard

<img src="observatory/public/mark.svg" width="54" height="54" alt="Pulseboard mark">

**A small operations desk for everything you ship.**

Pulseboard brings bounded product signals, synthetic checks, release context, and development evidence into one compact workspace. Its useful output is not a score or an automated reaction; it is an **evidence-backed next check** that keeps the source, time window, numerator, denominator, limitations, and proposed human action together.

[Open the hosted Desk](https://pulseboard-observatory.commit-atlas.workers.dev) ·
[Desk guide](observatory/docs/DESK_GUIDE.md) ·
[Architecture](observatory/docs/DESK_ARCHITECTURE.md) ·
[Direction](observatory/docs/DESK_DIRECTION.md) ·
[Hosting receipts](observatory/docs/HOSTING.md)

## Current live boundary

The hosted Cloudflare Worker/D1 Desk is live. Its operating boundary is deliberately narrow:

- authenticated aggregate reads are available to the operator;
- the browser can run deterministic invented scenarios without credentials;
- scheduled synthetic probes are registered for seven public origins, with a separate GitHub canary for the hosted edge;
- content-free collection is enabled only for the explicitly approved **Alibi pilot** through the `COLLECT_PROJECTS` allowlist;
- every other project integration remains inert until separately reviewed and activated;
- optional Alibi events require player consent and withdrawal stops later events;
- Taskdeck handoffs are reviewed files, not remotely issued commands;
- there is no portfolio-wide product-event collection or cross-product user tracking, and no automatic paging, deployment, remediation, or task creation.

The first consented Alibi events and a withdrawal check were recorded on 10 September 2026. The hosting runbook keeps the exact receipts and the known cold-path/cron limitations. A configured trigger, a green demo, or an admitted client event is never presented as proof of a complete monitoring system.

## What the Desk does

| Surface | Purpose |
| --- | --- |
| Portfolio desk | Searchable projects, routes, releases, UTC receipts, local/external boundaries, and explicit missingness |
| Signal inbox | Transparent rules with evidence, local acknowledgement, snooze, and reviewable next-check proposals |
| Release lab | Failure proportions, sample floors, descriptive Wilson intervals, and release-specific p95 duration |
| Scenario replay | Invented before/incident/recovery situations that exercise the interface without collector writes |
| Connections | Protected Observatory reads, CommitAtlas catalogues, reviewed Lens projections, and selected public probe capsules |
| Field notes | Previewed Markdown observations and JSON handoffs downloaded only after review |

The interface includes keyboard navigation, command palette, density controls, reduced-motion support, and narrow-screen layouts. Tokens, private snapshots, and imports stay in tab memory. Local acknowledgement/snooze and display preferences can persist in the browser. Imported context remains separate from operational readings and is cleared on disconnect.

## The product split

Pulseboard is intentionally not a general tracing backend, log database, task manager, or public portfolio page.

- **Observatory** admits a closed, content-free event vocabulary and bounded synthetic checks.
- **Pulseboard Desk** interprets those observations and helps choose the next investigation.
- **Developer Lens** remains the authority for development analysis and research methods.
- **CommitAtlas** remains the public presentation layer.
- **Taskdeck** remains the local-first execution workspace; a Pulseboard finding can become a reviewed proposal, never a remote instruction.

That split lets each tool keep a clear authority boundary instead of recreating the same partial platform in every repository.

## Run locally

Node.js 22.16 or newer is required. The Desk has no external runtime dependency and no build step.

```bash
git clone https://github.com/Chris0Jeky/Pulseboard.git
cd Pulseboard/observatory
npm ci
npm test
npm start
```

Open `http://127.0.0.1:8788`.

- Choose **Try a scenario** for an invented interactive portfolio.
- Paste the read token printed by the local runner to inspect the local collector.
- A clean database shows no production evidence.
- Local collection remains disabled unless the documented activation gates are deliberately changed.

For Cloudflare deployment, D1 schema application, secret handling, hosted browser proof, and the Alibi activation receipts, follow [HOSTING.md](observatory/docs/HOSTING.md) and [ROLLOUT.md](observatory/docs/ROLLOUT.md).

## Evidence and safety model

`GET /v1/portfolio?days=1|7|14` uses the existing read token and a transactional SQLite/D1 aggregate projection. It exports no raw event or session identifiers. API snapshots and imported files are bounded and validated before they reach the views.

A failed refresh retains a visibly stale last-good snapshot. An authentication failure clears private state. Requests have timeouts, cancellation, and generation guards. Hidden tabs pause polling. Assets use a self-only content security policy with no third-party fonts or scripts.

Pulseboard keeps these states distinct:

- **observation:** what a bounded source reported;
- **derived pattern:** a transparent calculation over observations;
- **hypothesis:** a question or possible explanation;
- **operator declaration:** a human note, decision, or incident statement;
- **missing evidence:** unavailable, stale, disabled, or not yet integrated — never silently converted to zero or success.

The project does not infer causation from temporal proximity, average incomparable quantiles, identify users across products, or turn commit/token counts into productivity scores.

## Direction

The next valuable loop is deeper, not broader:

1. complete one named journey from consent to admitted event to aggregate evidence to reviewed next check, including an intentionally broken path;
2. keep hosted D1, retention, query plans, headers, rollback, and credential rotation measurable;
3. add read-only GitHub release/workflow evidence with least privilege and bounded backfills;
4. add journey checks and an incident journal while separating scheduled samples, user outcomes, and operator declarations;
5. add reviewed native Developer Lens and Taskdeck bridges;
6. add private cost/run receipts and specialist adapters only when a real operational question justifies them.

Longer-term designs include reversible investigations, bounded specialist adapters, an opportunity ledger, calm ambient/public slices, and selective reuse of the legacy feed workbench. They are expansion seams, not shipped integrations. See [DESK_DIRECTION.md](observatory/docs/DESK_DIRECTION.md).

## Existing feed workbench

The earlier FastAPI/Vue pluggable-feed application remains in the repository as a separate runtime. Its original setup and behavior are preserved in [WORKBENCH.md](WORKBENCH.md). It has not been silently migrated into the Desk, and historical test/readiness claims in that document are not current certification. Its open quality-gate and packaging debt remain separate from the Observatory/Desk stack.

## Documentation

- [Desk architecture, API, and measurement semantics](observatory/docs/DESK_ARCHITECTURE.md)
- [Desk guide and browser test commands](observatory/docs/DESK_GUIDE.md)
- [Ecosystem contracts and integration status](observatory/docs/DESK_BRIDGES.md)
- [Direction and delivery order](observatory/docs/DESK_DIRECTION.md)
- [Hosting, activation, and verification receipts](observatory/docs/HOSTING.md)
- [Collection rollout gates](observatory/docs/ROLLOUT.md)
- [Asset provenance](observatory/docs/DESK_ASSETS.md)
- [Original Observatory module](observatory/README.md)

## Licence

Pulseboard is licensed under GPL-3.0-only. See [LICENSE](LICENSE).
