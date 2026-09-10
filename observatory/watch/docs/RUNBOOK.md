# Watch activation and operation

Nothing in this stack deploys infrastructure, enables collection, starts a scan, installs an agent on a product, sends a notification or blocks traffic. Merging code is not production activation.

## Gate 1: isolated local evidence

Run the complete existing Observatory test suite plus the new Watch tests. Use a disposable database and source aliases that cannot be mistaken for production. Confirm unauthenticated reads return 401, producer credentials cannot read, reader credentials cannot write, disabled ingestion returns 503, extra fields are rejected and duplicate receipts do not duplicate findings.

Use one source per project/environment/observation point. Fill `sources.example.json` privately; placeholders intentionally fail readiness. Generate independent secrets with a cryptographically secure generator (for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` on your own machine). Keep secrets out of command histories and CI logs. Use your normal secret manager in hosted environments.

The local runner creates Watch tables, performs retention at startup and every 15 minutes, and binds only to loopback. Do not change that bind to `0.0.0.0` as incidental convenience. Put remote access behind an authenticated private channel. The security reader currently sees the whole configured fleet; there is no multi-user RBAC.

## Gate 2: hosted parity, coordinated with #19

On a disposable D1 deployment, apply `watch/schema.sql` separately from the original Observatory schema, configure `WATCH_READ_TOKEN` and `WATCH_SOURCES_JSON` as secrets, and keep `WATCH_ENABLED=false`. Do not apply the source JSON as a public variable. Keep Wrangler's default-only `src/entry.mjs` entrypoint; it delegates to `src/watch-worker.mjs`, which preserves the original Worker's routes and schedule. The production probe schedule and same-account service bindings stay intact; the disposable preview has its own database and no cron.

Verify protected Watch readiness, all scopes, malformed/oversized/slow bodies, concurrent reservations, idempotent retries, clock skew, a failed scheduler and seven-day deletion. Measure rows read/written, latency, response size, database/WAL growth and deployment limits at realistic source volume. Test deployed CSP/no-store headers, not just local handlers. Test a read-token rotation and a single-source rotation. The implementation has no overlap key ring, so coordinate rotation with the producer and expect a visible gap rather than hiding it.

A gateway/WAF rate limit and platform cost cap must protect pre-auth traffic: source daily quotas apply after authentication and cannot stop unauthenticated request floods. An independent canary should check the collector and each producer. Do not use the collector's own green screen as its only health evidence.

## Gate 3: one actual product

Choose one Alibi or CommitAtlas preview/server route after inspecting the current host code and open telemetry PRs. Register stable aliases, not dynamic URLs. Confirm instrumentation runs on the server, not in a browser bundle. Add a fixture for successful requests, an auth rejection, an application error, queue loss, a collector outage and a restart. Preserve the original business response and exception. Show the source as partial during reported sampling/loss.

Then enable only that source, with a deliberately low quota and an explicit rollback. Confirm a known, harmless fixture appears in the private Watch and no event appears in public exports. Browser usage consent and the existing COLLECT_ENABLED flag are independent. Resolve host artifact debt #31 before treating existing SDK integration PRs as clean deployment inputs.

## Gate 4: owned-scope posture checks and internal sources

The adapter slice supplies dry-run-first tools. Review exact origin/path/status/header expectations and the manifest's expiry. A private route should return a reviewed rejection status; a public route should meet its declared policy. Do not infer an exposed secret merely from a 200 response or a missing header. Confirm with application routing and authentication tests.

Only execute on owned/authorized targets. Default HEAD checks do not crawl, follow redirects, use credentials, read response bodies or exercise exploit payloads. They can still create access-log traffic and can encounter application-specific HEAD behaviour. Use staging for ZAP or richer active tests, under separate reviewed budgets. The collector never runs a scanner based on an uploaded URL.

For hosts, execute the listener tool explicitly on the intended owned Linux machine. Its current network namespace may be a container, not the host. Inspect local details there; upload only a reviewed event batch through the correct host source. Missing proc tables mean unknown coverage. Do not substitute this for a firewall, flow sensor or endpoint protection.

## Investigation procedure

Start with source freshness, sampling, loss, retention state and admission pressure. Then inspect the specific source/asset/window behind a finding. Separate edge blocks from requests reaching the application. Check the matching restricted provider/application/host logs; Watch intentionally does not retain their raw payloads. Compare release changes as hypotheses, preserving alternative explanations.

Authentication bursts: check authentication-system evidence, lockout/rate policy and false positives. Unexpected endpoint: verify route/auth policy and SPA/caching behaviour. Host listener: confirm owning process, firewall and exposure locally. Scanner finding: examine the original report and applicability. Missing source: check delivery/configuration before assuming no attacks. No automatic block or account action is authorised by a Watch finding.

## Disable, recover, retain

Stop an affected producer or set its enabled flag false. Set `WATCH_ENABLED=false` to stop all new security receipts; this does not stop the existing availability probes or erase previous evidence. Rotate compromised credentials and inspect independent logs. Do not delete evidence as a reflexive first response to a suspected incident.

Retention continues while ingestion is disabled. `retentionOverdue` is a diagnostic requiring investigation, not a cleanup confirmation. Logical row deletion does not wipe database pages, WAL files or backups. Establish backup encryption, access, expiry and restore procedures separately. During restore, keep ingestion disabled, check the schema and source identity mapping, and verify restored timestamps remain visibly old.

Rollback by restoring the previously verified Worker version through the existing release procedure. For a source rollback, keep Wrangler on `src/entry.mjs` and change that file's default re-export back to `./worker.mjs`; do not expose the helper module's named exports as the workerd entrypoint. Watch tables can remain for controlled recovery/deletion; do not drop them automatically. If the Watch wrapper is removed, its hosted retention also stops and must be replaced or the dataset explicitly retired. Preserve the original Observatory's schema and behaviour.

## Required production decisions still open

Identity-aware operator access; separate database/Worker isolation; actual provider permissions/plan; source-specific quotas; log backend and retention; edge flood protection; collector self-monitor; host pilot; incident ownership and paging policy. Until those are validated, describe this as an implemented, tested local foundation with a deployment gate, not a deployed security operations platform.
