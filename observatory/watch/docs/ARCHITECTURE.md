# Security Watch architecture and threat model

Decision record, 2026-09-10. Baseline inspected: Pulseboard main `f895db41f3138d7d5cfce6ea025d2f20756fb8e6`. Existing monitoring direction is already implemented by #15–#17; #18–#24 cover the next operational slices. Watch is additive work under #35.

## Operator questions

Which applications are actually reporting? Which expected endpoints changed behaviour? Is authentication noise increasing? What did the edge block, and what reached the application? Did a host expose a new listener? Is the scanner failing silently? What should I verify next?

Answer those questions with independent sources and explicit uncertainty. Do not present a universal security score. More events can mean more coverage, more use, more bugs or more attacks. Without a denominator and source scope, it is only more events.

## Data planes

```text
PUBLIC PRODUCTS                         PRIVATE OPERATIONS
Browser SDK -- opt-in analytics ------> existing Observatory --> existing Desk

App / edge / scanner / host
  | configured aliases, no payloads
  | independent scoped producer keys
  +----> /v1/watch/events/<source> ----> bounded Watch SQLite/D1 tables
                                               |
                                      deterministic rules + coverage
                                               |
                                      separate Watch read credential
                                               |
                                      Security Watch + review export

Detailed logs / traces / packets ------> restricted specialist backends
                                               |
                                      future bounded adapters/deep links
```

The initial implementation shares the existing database binding but uses `watch_*` tables, separate routes, source credentials and a separate reader. That is logical separation, **not** database/process isolation. A compromised Worker or database administrator can still access both planes. Before a multi-tenant or sensitive deployment, split the security service into a separate Worker/database and front the operator surface with identity-aware access. Do not market this as tenant-isolated.

The collector has no URL-proxy endpoint, scanner execution endpoint, shell execution, LLM call, public security export or remediation route. The only external requests added by the producer happen after an integrator explicitly enables and flushes it. The standalone posture tool executes only an approved local manifest; the browser cannot ask the collector to scan arbitrary targets.

## Contracts and budgets

`watch/contracts.mjs` is the executable contract. Source configuration has exactly: `id`, `project`, `environment`, `kind`, `token`, `assets`, `allowedKinds`, `heartbeatSeconds`, `dailyLimit`, `enabled`. Kinds distinguish app, edge, scanner and host. Project/asset/source names are configured aliases, not unbounded request paths. Never repurpose a source ID across projects or environments: historical rows currently join to the present configuration. Create a new source identity instead.

Limits: 12 sources, 24 assets per source, 16 KiB JSON request, 25 events and at most one heartbeat per batch, 5-second body deadline, 20,000 daily attempts per source at the absolute configuration ceiling, 200 returned ledger rows and seven-day receipt retention. The example uses a lower limit. These are defensive ceilings, not a throughput or cost certification. Queries still scan the selected 24-hour window. Measure D1 query cost, CPU and storage before raising limits or adopting them for a busy product.

Every event has a canonical v4 UUID and an integer observation time between receipt time minus one day and plus 30 seconds. Different kinds have closed field sets. HTTP observations carry an allowlisted method/status and optional bounded handler duration; scanner observations carry a hash and level. No caller-provided free-text finding title or remediation instruction is admitted.

Authentication precedes database reads. Producer keys cannot read snapshots; reader keys cannot submit. A producer is fixed to one project/environment/asset/kind scope. All responses are no-store, no-referrer, nosniff and same-origin resource policy. Ingestion supplies no CORS permission and rejects an Origin header. Origin rejection is defence in depth, not authentication: a non-browser client can omit it.

## Admission and integrity

One transaction reserves a source's UTC-day budget and inserts only rows gated by that reservation's random receipt. A first oversized reservation is rejected as well as a later one. Concurrent reservations cannot both overrun the cap on the tested SQLite path. D1 uses its transactional batch interface; hosted parity is still a release gate.

Attempts consume budget, including duplicate IDs and retries. This bounds the cost of authenticated replay rather than offering unlimited free duplicate traffic. Duplicate IDs do not create more evidence. The response separates `inserted`, `charged` and `used`. At 80% admission pressure the model asks the operator to check the budget. A full budget also rejects heartbeats; missingness must remain visible.

A heartbeat records both observation and first-receipt time. Replaying an old ID or changing the payload attached to an existing ID must not refresh the sensor. Only a newer observed heartbeat advances sensor state. This is replay resistance within retained receipts, not cryptographic provenance or tamper-evident audit storage. Event IDs are forgotten after retention; late data outside the admission window is rejected. No claim of forensic non-repudiation is made.

A source credential can forge plausible reports and consume its own budget. Rotate a compromised key, disable the source and investigate through independent infrastructure evidence. Since the model does not collect person/IP identifiers, distributed password spraying and per-actor attribution need a provider/authentication-system adapter; they cannot be inferred from these counts alone.

## Coverage and rules

Coverage states are disabled, missing, clock-skew, stale, partial and reporting. Freshness uses the older of observed and received times, with a grace of three configured heartbeat intervals. Reported sampling or any reported loss makes coverage partial. A heartbeat's `full` label is the producer's assertion about its configured feed, not proof that all security-relevant activity is observed. An app-only source cannot see requests stopped at the edge or host-level traffic.

The initial rule version is `watch-rules/1`. Authentication/permission failures, rate limiting, WAF blocks and handler errors use explicit five-minute count thresholds. Exposure, scanner and host observations use a one-day evidence window. A server-error fraction is evaluated only with at least 20 request receipts and five errors, using the same source and asset for numerator and denominator. Do not combine edge and application counts as unique traffic or blend different sampling policies.

Each finding includes source, project, asset, rule version, evaluated time, evidence count/window, title, limitation and next check. It remains an `observation`. Thresholds are triage defaults, not a classifier trained to establish malicious intent. A WAF block can be a false positive, a 500 spike a deployment bug, and an unexpected 200 an SPA shell. The retained scanner level is not automatically a vulnerability severity or exploitability verdict.

The model does not implement incident acknowledgement, persistent resolution, scan-run reconciliation, recovery hysteresis, suppression expiry, paging or automatic response. A receipt aging out of the window is not proof of recovery. These belong in the incident/scan lifecycle follow-ons, coordinated with #21.

## Storage and serving

Watch's additive schema has its own readiness marker and indexes. Existing schema version, portfolio contracts, browser builds and public-probe targets are unchanged. `src/watch-worker.mjs` wraps the existing Worker rather than replacing its routes. The original scheduled probes still run as before; Watch adds retention, not new scans.

The local runner executes Watch retention at startup and every 15 minutes without network access, including while ingestion is disabled. The hosted wrapper attempts retention at the existing cron and emits a fixed diagnostic if it fails; it does not log exceptions or payloads. Snapshots expose `retentionOverdue`. Retention is logical deletion, not guaranteed physical erasure from SQLite pages, WAL files, snapshots or provider backups. Encryption, backup expiry and restore policy are deployment responsibilities.

Snapshot reads are transactional and bounded in output cardinality. Events are selected by observation time in `[now - 24h, now)`; future-dated receipts do not become present evidence. Stored source records no longer in configuration are excluded from the operator projection. Retention still applies to them. The ledger is the latest 200 minimised receipts, not a complete searchable log archive. It has no pagination in this slice.

## Threats, controls, remaining work

| Threat | Present control | Residual / next gate |
| --- | --- | --- |
| Public event spoofing | Server-only scoped Bearer credentials | Compromised producer can lie within its scope; independent evidence needed |
| Cross-project injection/read | Fixed source scope, separate reader, closed contracts | Single fleet reader; no per-project operator RBAC yet |
| Collector DoS / cost abuse | Body/time/cardinality/daily limits | Pre-auth floods still need edge limits and deployment budgets |
| Replay / duplicate alert inflation | Composite IDs, transactional budget, original heartbeat timestamps | No signed receipts or tamper-proof storage |
| Secret leakage | No raw fields; configuration never exported; generic errors | Private source config, backups and upstream logs still need care |
| XSS / instruction-shaped logs | No free-text ingest; fixed rule copy; escaped UI projection | A future richer log adapter must retain this boundary |
| SSRF / destructive scans | No remote scan API; standalone HEAD-only exact manifest | Owned-origin review and egress controls remain necessary |
| Silent sensors | Dual timestamps, explicit sampling/loss, stale/missing states | App restarts and event loss before instrumentation may be invisible |
| False recovery | Findings called observations; no resolved state inferred | Persistent incident and scan lifecycle follow-on |
| Monitoring as a single point of failure | Instrumentation fails open; bounded queues; protected readiness | Independent canary and source health checks before reliance |

## Validation contract

New tests must prove scope, credential separation, malformed input, byte/time limits, transaction rollback, concurrent admission, replay, event window edges, stale/partial sensors, source-separated denominators, retention and legacy route delegation. Browser tests additionally need real HTTP serving/CSP, keyboard/mobile behaviour, disconnect/401 cleanup, stale reads and deliberate export. A local SQLite test is not hosted D1 parity. Existing full Observatory and Desk gates remain mandatory; legacy #13/#14 are not repaired by Watch.
