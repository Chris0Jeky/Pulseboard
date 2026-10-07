# Maintenance checkpoint: 2026-10-07

This is a dated recovery record, not a continuously updated health claim. GitHub
main, PR heads and their current checks remain authoritative. No collection,
consent, credentials, budgets or HUMAN_TODO decisions were changed by this pass.
Existing approved main-triggered Observatory deployment remains in effect.

## Recovered and delivered

The initial archive matched main `37a919e`. The interrupted pass had already
merged #200 (object-only feed configurations), #201 (named-operation retry
candidates) and #202 (bounded per-feed history), ending at `589e40f`. Those changes
were preserved, not recreated as duplicate PRs.

| PR | Result | Verification at its final head |
| --- | --- | --- |
| #203 | Real HTTPS keepalive receipts; corrected no-store preflight expectation; independent cache control | Head `1f9ba2e`, Observatory run 37554062911, browser run 37554062917. Three 194-byte deliveries; control preflights 1,1,2,3. Merged `a389726c`. |
| #204 | Serialized per-feed lifecycle and fresh post-stop database definitions | Five expected failures before fix, then 184 backend passes plus Ruff/mypy/package. Head `3e7f1049`, backend run 37555122544, package 37555122564. Merged `388a8766`. |
| #205 | UTC-day precision for new aggregate receipt writes; separate hour totals unchanged | Three precision regressions before fix, then 602 local tests. Head `e862ace1`, Observatory run 37555584542, browser 37555584574. Merged `2642aea1`. |

The historical #112 follow-up adds manual audit/cleanup SQL with schema/type/date
guards and real SQLite preservation, idempotence and rollback tests. It does not
run against hosted D1. See [STATISTICS_PRECISION.md](STATISTICS_PRECISION.md).

No independent subagent reviewer was available. Each delivery had a separate
self-review and exact-head CI checks; this is not an independent review claim.
Local full backend execution was dependency-blocked, while hosted backend checks
ran the full suite. Local browser navigation was administratively blocked, so
browser proof comes from hosted Actions, not a bypass of that environment.

## Open issue disposition

All 14 issues were read with their discussions. A completed subtask is not the
same as completing its broader acceptance criteria.

| Issue | Remaining work / boundary |
| --- | --- |
| #18 | Qualify a current real host journey end to end; distinguish legacy events from newer product-event paths and synthetic fixtures. |
| #19 | Hosted aggregate query-budget/parity and rollback evidence remain distinct from local SQLite tests and earlier admission/header receipts. No new hosted resources were created. |
| #20 | The mapped connector already exists. Durable caching, richer saved notebooks and deployed behavior require their own scoped proof; do not repeat old unconfigured-state claims as current facts. |
| #21 | Read-only journey canary and shared incident journal; notification remains gated, not inferred from local acknowledgement. |
| #22 | Native destination integrations and acceptance evidence; sample proposal receiver is not native Taskdeck task creation or execution permission. |
| #23 | Local receipt adapter exists; actual provider coverage and verified-outcome evidence remain separate. |
| #24 | Select and qualify a bounded legacy/specialist evidence adapter; do not add new legacy workbench features under maintenance. |
| #73 | Retry accounting corrected in #201. Explicit orphan-terminal reporting needs compatible reader changes, and current Alibi hook order still needs host evidence. |
| #75 | Config shape, history count and demonstrated stop/restart/stale-row races repaired. Async-route synchronous DB work, global shutdown/custom plugin cancellation and local-only SSRF/auth policy remain separate. |
| #99 | Jurisdiction/provider-processing qualification remains unresolved here. Payload minimization alone is not that evidence. |
| #112 | New writes are coarse. Verify actual hosted cleanup or expiry of old precise rows; backups and sparse read differencing remain limitations. |
| #122 | All new delivery cases pass, but historical missing-event root cause remains unproved. Self-signed fixture TLS diagnostics are noisy; no delivery assertions were weakened. |
| #150 | Measure actual D1 size and shared Voices budget use before changing limits or allocation. No increase made. |
| #169 | Producer identity/conformance work exists; retain compatibility boundaries until native consumer evidence and legacy-identity handling are qualified. |

## Continuation rules

Read the latest PR discussion and exact tested head before resuming. Keep patches
on separate branches and publish drafts before relying on hosted CI. Do not treat
a passed test subset, a stale run, a skipped deployment, or an unsigned handoff
hash as broader proof. Keep pre/post data-cleanup evidence free of raw timestamps,
credentials and private payloads. Do not close umbrella issues on partial work.
