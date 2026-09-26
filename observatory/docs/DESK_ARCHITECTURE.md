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

The original Desk reader needed no new runtime dependency, database table or
schema migration. The later Alibi statistics producer adds the `statistics`
table in schema version 2; its migration is `migrations/0002-alibi-statistics.sql`.
`src/portfolio.mjs` still consumes only the existing opt-in session event rows.
The separate `GET /v1/statistics/<project>?days=7` read (any registered public project since #102; 1, 7, 14, 30 or 90 UTC
calendar days since collector v4) authenticates with the Desk read token, reads only daily aggregate rows,
and returns `pulseboard.statistics/4`: event, daily, route and release totals, per-day event
totals, and twelve separate dimension totals, every breakdown summing to the same total. Country
(schema 3, #103) plus region, browser, os, language and hour (collector v4) come from the request on the
server; device, source and visit (v2 context) plus scheme, referrer and campaign (v3 context) come from
the browser. Region, language, referrer and campaign keep at most 50 distinct values per project and UTC
day; a later new value is stored as `other`, while `unknown`, `none` and `other` are never capped. Dimension totals live in `statistics_dimensions`, keyed by day,
dimension and value only, with no timestamp finer than the day, and stored `WITHOUT ROWID` so
storage order is key order rather than arrival order. That makes re-joining a request's rows to its
event counts harder, not impossible: an operator who polls the one-day read repeatedly while
traffic is sparse can still difference single requests, and `statistics.received` keeps the last
write time. With a handful of testers this is not anonymity (`USAGE_PLAN.md`). Counts from before a dimension was recorded read `unknown`, and so do the browser dimensions a
batch's version does not carry (v1 has none, v2 has device, source and visit). The country and region
are Cloudflare's edge codes; the User-Agent is classified into a closed browser and OS vocabulary and
dropped, the first `Accept-Language` tag is reduced to its primary subtag, and the collector never reads
the IP. Schema 1 carried
only event and daily totals; route and release totals were added for the Desk's
Usage view, matching the route receipts and release cohorts the operator already
reads for opt-in data. It returns no session estimate, visitor count or flow. Its `collectionAdmitted` and `observationStatus`
fields distinguish a disabled collector from observed counts. These results
must never be summed with the legacy portfolio's opt-in population. Pure decision helpers
live in `public/desk-model.mjs`, shared with the browser without bundling server
configuration. `public/desk-demo.mjs` creates deterministic invented snapshots.

## API

`GET /v1/portfolio?days=7` requires the existing `Authorization: Bearer <READ_TOKEN>`
header. Supported windows are exactly 1, 7 and 14 days. Duplicate, unsupported and
non-canonical window values fail with 400. Authentication precedes database reads.
Responses use `Cache-Control: no-store`; unauthenticated reads return 401.

The schema identifier is `pulseboard.portfolio/2`. A response contains the UTC
window, generation time, collection switch, explicit limitations, and configured
projects with separate `collectionEligible` and `collectionAdmitted` flags alongside
bounded event aggregates, route receipts, release cohorts, sampled probe outcomes,
current probe state and today's admission budget. A zero event count for a registered
but non-admitted project is therefore not presented as evidence of no traffic. No raw event,
session or receipt identifier is returned. Projects without data remain present.

The reader performs nine SELECTs in one D1-compatible transactional batch. Its
range is `[start, end)`: the lower bound is included, the upper bound and future
rows are excluded. Daily buckets use UTC; both edge days may be partial. Product
event retention is 90 days; legacy session events, aggregates and budget rows keep 14 days (the
deployed opt-in and statistics notices promise 14 days; `AGGREGATE_RETENTION_DAYS` becomes 400 once no
host shows the old notice, host wave #105) and probe history 30 days
(collector v4, `USAGE_PLAN.md`). Counts are admitted events,
not offered traffic or verified people. The contract bounds possible groups;
SQL still scans the selected window. This is not a high-volume analytics engine.
The separate Alibi statistics producer admits only closed event counts, stores
one aggregate row per UTC day, event, route and release, and retains at most
`AGGREGATE_RETENTION_DAYS` (14) UTC calendar dates including today; a 30- or 90-day read shows only what is kept. It accepts no session or event identifiers. The
reviewed deployment configuration admits `alibi` through `COLLECT_STAT_PROJECTS`, which since #102 is an exact comma list of
registered public ids (any malformed entry disables it). It needs `COLLECT_ENABLED` and a valid session policy but not `COLLECT_PROJECTS` membership, so admitting counts never opens a host's session route;
actual admission begins only when that configuration is deployed. The separate
statistics reader keeps these counts out of the legacy opt-in readout. Repeated
requests count repeatedly because aggregate-only payloads have no dedupe key.

### Product events (schema 4, collector v4)

`POST /v1/product/<id>` admits `pulseboard.product-batch/1` (`USAGE_PLAN.md` section 2): exactly
`{ v: 1, session, release, context: { device }, events }` with 1 to 20 events of exactly
`{ name, route, seq, ms }` and optional `props`. `session` is a lower-case UUID v4 for Journeys or
`null` for Diagnostics-only batches. `props` is open JSON bounded to depth 4, 32 keys per object, keys
`^[A-Za-z0-9_.-]{1,48}$`, strings of 256 characters, arrays of 32 items, finite numbers and 2,048
serialized bytes; a batch outside those bounds is refused whole. Personal keys (the plan's list plus
nickname, display name, player, user, handle and name-part keys, user and client ids, IP address
keys, `url` and `href`; a bare `name` stays) are removed at every depth and counted in `redacted`. In
strings, e-mail-looking text becomes `[email]`, IPv4 and IPv6 addresses become `[ip]`, and `scheme://`
URLs are cut to their host, including IPv4 before a full stop and IPv4-mapped IPv6. A key that is itself an
address is dropped and counted. After redaction strings are cut back to 256 characters, and props that
redaction grew past 2,048 bytes are dropped whole and counted. Redaction never rejects. `page.view` is an ordinary product name. Admission needs `COLLECT_ENABLED`, a valid session policy and the id in
`COLLECT_PRODUCT_PROJECTS` (the same exact-list parser as `COLLECT_STAT_PROJECTS`, not `COLLECT_PROJECTS`
membership), the registered origin, `application/json` and 16 KiB. Its daily budget is its own row
`<id>:product` in `budget`, limited by the registry's `productLimit` (1,000), and every project also
draws on one global row `*:product` (1,500 a day), reserved in the same D1 batch: the project row is
reserved only if the global row has room, and the global row is charged only against that receipt,
so either budget full returns 429 and charges neither. Rows go to
`product_events(project, received, day, session, seq, name, route, release, ms, props, redacted,
country, region, browser, os, device)` in the same D1 batch as the reservation, gated on its receipt.
Delivery is at most once; repeated requests store repeated rows.

`GET /v1/product/<id>?days=` (authenticated, windows 1 to 90) returns `pulseboard.product/1`: totals
by name, route, release and day; sessions (count, median events, median duration between the first
and last received batch); the latest 100 journeys as `{ session, startedAt, durationMs,
steps, stepsTruncated }` (first 60 step names); exits (each session's last event inside the window, summing to the
session count); vitals as the nearest-rank p75 of raw, non-negative `web.vital` values per metric and
route, never an average of percentiles; and the 100 most frequent `js.error` groups by `kind` (64
characters, missing reads `unknown`) and `message` (160). Names, routes and releases keep the top 512,
256 and 64 rows by count (ties by value) and report `totals.truncated`; a truncated list sums to less
than `total`, and days are never truncated. Error text is cleaned of control characters and cut by
UTF-16 length in JavaScript without splitting a surrogate pair.

**Storage sizing.** The account is on Cloudflare's free plan (HUMAN_TODO q-6), where one D1 database
holds at most 500 MB, and a full database refuses every write, Alibi's counts included. A stored
product event is about 2.3 KB with its indexes at the 2,048-byte props bound. The global budget of
1,500 events a day over 90 days of retention is therefore at most about 1,500 x 2.3 KB x 90 = 310 MB,
leaving room for the aggregates, legacy events and probe history. The per-project 1,000 keeps one
project from taking the whole global budget alone. Raise either only after measuring D1's reported
size or moving to a paid plan. `GET /v1/product/<id>/events?days=&name=&limit=` returns up to 5,000 raw rows
newest first (default 500; `name` optional) as `pulseboard.product-events/1`. `GET /v1/consent/<id>` answers the SDK's
region hint `{ v: 1, region: 'eea' | 'other' }` from the edge country (unknown reads `eea`) for the
registered origin only, with `Cache-Control: private, max-age=3600`; it stores nothing and does not
depend on admission. `/readyz` reports `product: { configured, admitted }` beside `statistics`.

`/v1/summary` is preserved for compatibility, including its original seven-day
session-level flow semantics. New consumers should use `/v1/portfolio`. Do not
combine the two flow measures as if they shared a denominator.

## GitHub development evidence

`GET /v1/github-evidence?project=<id>` (issue #20, first slice) has its own closed
contract, `pulseboard.github-evidence/1`, so `/v1/portfolio` is unchanged. It
authenticates exactly like the portfolio read; a missing, repeated or unregistered
project, or any other parameter, is a 400; responses are `no-store`. No table,
migration or stored row is added. The desk requests it only when the operator
presses "Read workflow evidence" in a project dossier, never in the poll, and the
result never enters `buildSignals`, a handoff or a public pulse.

The mapping (`src/github-map.mjs`, `pulseboard.github-map/1`) is reviewed source
that names numeric repository and workflow ids; display names are checked, never
matched. Mapping a project is an owner decision (`HUMAN_TODO.md` q-9); Alibi is mapped (its `check.yml`
on `main` and its releases; no deployment environment, since Alibi publishes outside GitHub deployments).
`readGithubMap` refuses extra fields, unregistered projects, a workflow without an
id, one (repository, workflow, branch) claimed twice, one repository id under two
names, and more than 4 repositories, 4 workflows, 2 environments or 10 releases.

`src/github.mjs` runs only when a server-side `GITHUB_EVIDENCE_TOKEN` is set (the
local runner prints whether it built the connector; the hosted Worker gets it only as a
Wrangler secret, see `docs/HOSTING.md`). Without one, mapped items read `unconfigured` and nothing is requested.
Requests go only to `https://api.github.com/repositories/{id}/...` (repository,
workflow runs for the mapped workflow and branch, the latest deployment and its
status per mapped environment, recent releases) with `redirect: 'manual'` (the
value workerd accepts, as measured for the probes). No `credentials` option is
sent: a server fetch has no cookie jar, and workerd may reject the field, which
would read every item as `unavailable/network`. A redirect, or a `Link` next page on
another host, another repository or another endpoint, is refused. The token is sent
only in the `Authorization` header and never enters a cache key, response, error or export.

Each workflow, environment and release list reads one closed state (`unconfigured`,
`missing`, `pending`, `passing`, `failing`, `inconclusive`, `stale`, `rate-limited`,
`unavailable`, or `observed` for presence without a pass/fail meaning) plus a reason,
`observedAt`, `sourceTime` and identity (workflow id, path, branch, run id and
attempt, 40-hex head SHA; deployment id, SHA and environment). A run from another
workflow or branch is discarded, and there is no repository-wide CI field. A
renamed repository is flagged with `renamed: {mapped, observed}`. A reading older
than six hours, dated in the future, or a failed refresh falling back to the cache
is `stale`, with the reading moved to `lastKnown` and the current fields null, so it
cannot render as current. 404 is `missing/not-found-or-no-access`; 401, a plain 403,
a redirect, an oversized or malformed body and an exhausted request budget are
`unavailable` with distinct reasons; a primary or secondary rate limit is
`rate-limited` with `resetAt`, and no request is made until then.

`deploymentLeads` marks a deployment in the 24 hours before an opened monitor, or
inside a down monitor's window, as a `lead` that says "Temporal proximity, not a
cause." The release notebook pins a frozen copy of the snapshot and the evidence
with `desk-rules/1`, `github-evidence/1`, the mapping revision and a snapshot
fingerprint; the operator must write what they suspect and an alternative check
(bounded, URL and credential shapes refused) before a `pulseboard.release-note/1`
JSON or Markdown file can be previewed and downloaded. The pin lives in tab memory
only and is cleared on disconnect and on pagehide.

## Measurement choices

- **Outcomes:** completed and failed event counts. Repeated attempts can appear
  more than once. There is no operation ID or verified transaction success.
- **Paired flow:** first request in each session / route / release group, followed
  by a completion in that same group with a larger sequence number. Both events
  must fall inside the window. This is not a named-action or cross-device funnel.
- **Duration:** exact nearest-rank p95 from the selected samples, separately for
  each release. Percentiles are never averaged. `n`, mean and method travel with it.
- **Probes:** successes / scheduled samples. Missing samples stay missing. This
  is not time-weighted uptime, an SLO, or proof of an entire product journey. A
  target that is another Worker on the same Cloudflare account is reached through
  a service binding (`probe.binding` in `src/projects.mjs`), so its reading proves
  the application answers, not that its public address does; the read model adds
  that sentence to `limitations`, and the GitHub canary checks the public path.
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
