# Pulseboard hosting compatibility

Reference-only preparation, 2026-09-10. The versioned `manifest.json` is not read by the application and cannot authorize deployment. No billing, DNS, runtime, trigger, collection, probe or data change is made here. Existing main-push workflows may still run after a future merge.

## Reuse the current deployment

The current `observatory/docs/HOSTING.md` records an existing Worker/D1 deployment. It explicitly records collection disabled and an empty cron list. Reconcile that receipt against the current account before acting. Do not provision a duplicate Worker/database, replace the D1 data, or restore the earlier configuration whose cron began on deployment. Account-plan identity remains a separate dashboard check.

## Bounded next slices

PB1 reconciles the actual Worker version, database binding, schema and disabled paths without exposing credentials. PB2 may add a small hosting projection through the existing Desk/bridge contracts: stable service identifier, declared runtime, canonical public URL, source time and evidence state. Unknown, repository-reported, deployed and independently verified must remain distinct. Private service origins and operator billing/account records belong outside public projections. No new provider write integration is implied.

PB3 owns separate scratch-D1 admission, deduplication and 429 acceptance before collection activation. Probe targets and schedules have a different approval and test path. Browser consent, payload restrictions and private read authorization stay intact. CORS and admitted-event budgets are not authentication or a hard bill cap. Keep the legacy FastAPI/Vue workbench separate; the Desk gate does not close its debt.

## Verification

Syntax: `python -m json.tool .hosting/manifest.json`. Follow `CLAUDE.md`, `AGENTS.md`, the owner queue and existing skills. This is a reference, not another agent prompt system or harness. For follow-on Desk code use `cd observatory && npm test`; browser changes require the existing suite against a real local server. Hosted D1 and collection tests require their own actual receipts.

Before any promotion, preserve the previous Worker version, compatible schema and backup. Review route-specific asset serving only with CSP/auth/API tests; do not blindly remove `run_worker_first` as a cost optimization. Never publish a read token, private projection or unregistered naming candidate in this repository.
