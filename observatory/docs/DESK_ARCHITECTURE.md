# Pulseboard Desk: evidence foundation

## The job

Give a small portfolio operator a useful answer to three questions: what changed,
what needs checking, and what evidence supports the next move? Keep the collector
small, the desk fast, and the difference between missing data and good news visible.

This is a staged extension of PR #15, not a production migration. The legacy
FastAPI / Vue feed workbench remains separate and unchanged. Existing databases,
browser SDKs, collectors, probe targets and collection defaults are retained.

## Boundaries

| Component | Owns | Does not own |
| --- | --- | --- |
| Observatory | Closed event contract, admission budgets, probes, retention | Private task contents, arbitrary payloads, user identity |
| Aggregate reader | Bounded, transactional evidence projections | Raw event exports, retrospective causal claims |
| Desk model | Deterministic observations, descriptive comparisons, review handoffs | Remediation, deployment, paging, universal health scores |
| Desk UI (next slice) | Triage, cohort inspection, replay, deliberate downloads | Silent collection activation or publication |
| Legacy workbench | Existing custom feeds and live panels | A claimed migration into the Desk |

No new runtime dependency, database table or schema migration is required.
`src/portfolio.mjs` consumes the existing SQLite/D1 schema. Pure decision helpers
live in `public/desk-model.mjs`, shared with the browser without bundling server
configuration. `public/desk-demo.mjs` creates deterministic invented snapshots.

## API

`GET /v1/portfolio?days=7` requires the existing `Authorization: Bearer <READ_TOKEN>`
header. Supported windows are exactly 1, 7 and 14 days. Duplicate, unsupported and
non-canonical window values fail with 400. Authentication precedes database reads.
Responses use `Cache-Control: no-store`; unauthenticated reads return 401.

The schema identifier is `pulseboard.portfolio/1`. A response contains the UTC
window, generation time, collection switch, explicit limitations, and configured
projects with bounded event aggregates, route receipts, release cohorts, sampled
probe outcomes, current probe state and today's admission budget. No raw event,
session or receipt identifier is returned. Projects without data remain present.

The reader performs nine SELECTs in one D1-compatible transactional batch. Its
range is `[start, end)`: the lower bound is included, the upper bound and future
rows are excluded. Daily buckets use UTC; both edge days may be partial. Event
retention is still 14 days, probe history 30 days. Counts are admitted events,
not offered traffic or verified people. The contract bounds possible groups;
SQL still scans the selected window. This is not a high-volume analytics engine.

`/v1/summary` is preserved for compatibility, including its original seven-day
session-level flow semantics. New consumers should use `/v1/portfolio`. Do not
combine the two flow measures as if they shared a denominator.

## Measurement choices

- **Outcomes:** completed and failed event counts. Repeated attempts can appear
  more than once. There is no operation ID or verified transaction success.
- **Paired flow:** first request in each session / route / release group, followed
  by a completion in that same group with a larger sequence number. Both events
  must fall inside the window. This is not a named-action or cross-device funnel.
- **Duration:** exact nearest-rank p95 from the selected samples, separately for
  each release. Percentiles are never averaged. `n`, mean and method travel with it.
- **Probes:** successes / scheduled samples. Missing samples stay missing. This
  is not time-weighted uptime, an SLO, or proof of an entire product journey.
- **Release comparison:** reported failure fractions with descriptive 95% Wilson
  intervals. A 20-outcome floor in both cohorts gates the percentage-point
  difference. The floor is a display guard, not statistical power or significance.
  Different routes, users, retries and exposure can explain a difference.
- **Freshness:** a missing, future-dated or older-than-30-minute probe cannot be
  shown as current health. The read model applies that rule before the response
  leaves the server — `monitorState` in `src/contracts.mjs`, shared with
  `/v1/summary` — so the browser is not the only place it holds. Local-only
  projects do not acquire external probes.

These choices are deliberately inspectable. Route-specific action correlation,
release deployment timestamps, operation IDs and sampling-aware estimators need
new contracts and new tests; they must not be inferred from the current fields.

## Rules and local review

`desk-rules/1` surfaces failed / stale / missing probes, disabled collection, old
snapshots, admission pressure at 80%, at least 10% failed reported outcomes with
20 samples, and predominantly unattributed releases. Every observation carries
its rule, evidence and next check. There is no blended portfolio score.

Review keys include demo/live mode, rule, project and a hash of the evidence.
Acknowledgement and snooze are presentation state, not server incident state.
Changed evidence resurfaces. Hashes deduplicate local review keys; they are not
cryptographic provenance or signatures. Reviewed Markdown and JSON handoffs do
not execute changes or create tasks.

## Serving and operational safety

The local runner binds to `127.0.0.1`, defaults to port 8788, and supports an
explicit `PORT`. It generates an ephemeral read token unless one is configured.
Nothing activates collection by opening the desk. Local startup does not schedule
external probes. The original rollout gates still apply before hosted use.

The Worker and local runner share a static asset allowlist. Files are not derived
from arbitrary paths. The static surface has a self-only CSP, no inline-script
permission, no framing, no referrer, no storage cache and no third-party fonts.
The next UI slice uses these routes; the existing dashboard remains compatible.

## Verification

`cd observatory && npm test` runs both the existing kit tests in a complete checkout
and `tests/desk.test.mjs`. The 24 new tests were run locally against real Node SQLite
on Node 22.16.0. They cover authentication, range boundaries, flow isolation,
percentile calculation, projection minimisation, deterministic rules, replay and
asset routing. Existing kit tests must also pass on the complete PR checkout.

Hosted D1 execution and full browser HTTP navigation were verified on 2026-09-10
(`HOSTING.md`, `VALIDATION.md`); the Desk is deployed with scheduled probes on and
collection off. Production telemetry remains a separate gate that needs a reviewed
pilot. Legacy quality-gate debt remains tracked in #13 and #14.
