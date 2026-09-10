# Pulseboard Observatory

A self-contained observability kit for a portfolio of small products. Cloudflare Worker + D1 in production, a dependency-free Node/SQLite runner locally, a protected dashboard, a consent-gated browser SDK, and a checked installer for other repositories.

Version **0.1.0**. This is an initial implementation, not a claim that every connected product is already sending events. All browser integrations and production collection ship **disabled**. Nothing here merges or deploys the application PRs.

## Start locally

Node **22.16 or newer** is required. The local adapter uses Node's `node:sqlite` API, which emits an experimental warning in Node 22.16; the production Worker uses Cloudflare D1 instead.

```sh
cd observatory
npm test
npm start
```

Open the local address printed by the runner and paste its temporary read token. The token is held in browser memory, not a cookie, URL or localStorage. The runner binds to `127.0.0.1`, stores its database under ignored `.data/`, and does not contact the public sites. **Explore synthetic demo** requires no token and never writes invented events into the database.

An empty live dashboard is the expected first result. Unknown, stale, down and confirmed-up monitoring states are distinct. Product event silence is not treated as service health.

## What works

- Closed, versioned event schema. Both client and server reject unknown fields, event names, routes and releases. No raw URLs, queries, user names, document content, filenames, task text, prompts or error messages are admitted.
- Explicit consent, DNT/GPC checks, public-origin and path scoping, automated-browser exclusion, ephemeral page-session IDs, withdrawal cancellation, bounded memory/batches/requests, timeouts and a failure circuit breaker. Offline exports and local runtimes do not report.
- Transactional daily admission budgets, server receipt times, event-ID deduplication, an authenticated seven-day aggregate API and 14-day raw retention.
- Fixed-target HTTPS synthetic probes with content checks, no redirects, bounded response reads, three-failure/two-success state transitions, stale-signal detection and 30-day probe history.
- A real dashboard with protected collector reads, a separate synthetic demo, aggregate export, per-project evidence and deterministic investigation prompts.
- An overwrite-safe SDK installer that records each generated file's SHA-256 in a lock keyed by target, so several installs can coexist in one repository. Existing user edits and symlinks are refused, including dangling ones at the target, the lock path or a parent.

## Deploy the collector

Use a separate Worker and database. Do not expose the existing Pulseboard application to the internet on the assumption this module secures its unrelated endpoints.

```sh
# Run from this directory. Wrangler is deliberately not a browser dependency.
npx wrangler@4.129.1 d1 create pulseboard-observatory
# Put the returned database ID in wrangler.jsonc.
npx wrangler@4.129.1 d1 execute pulseboard-observatory --remote --file schema.sql
npx wrangler@4.129.1 deploy --dry-run
npx wrangler@4.129.1 deploy
npx wrangler@4.129.1 secret put READ_TOKEN
```

The deployed Worker carries a 15-minute cron trigger, so **synthetic probing of every registered project origin begins on the first deploy**, before any browser integration exists. `COLLECT_ENABLED` gates browser event admission only; it does not gate probing. Review `src/projects.mjs` before deploying, or remove the `triggers` block in `wrangler.jsonc` until you have.

Generate a unique, high-entropy read token of at least 32 characters. Keep it in a password manager. It grants portfolio-wide aggregate access; this version is for a single operator, not a multi-tenant service. Set it as a Worker secret, never a public build variable. Rotate by replacing the secret. Dashboard assets contain no private data; `/v1/summary` requires the token. `/healthz` is liveness only; `/readyz` checks the migrated database.

Before collection: review `src/projects.mjs`, current privacy notices and the actual deployed origins. Replace or remove anything not owned by you. Keep Taskdeck's origin null. Test a preview deployment, inspect a received payload, and confirm refusal after revocation. Then change `COLLECT_ENABLED` to `"true"` and redeploy. Its default is `"false"`.

Wrangler deployment and Cloudflare behavior must be verified in your account. Local tests use real SQLite, not a fake in-memory database, but they are not a claim of hosted D1 integration verification.

## Add another project

Register its fixed origin, probe URL/marker, routes, event names and release identifiers in `src/projects.mjs`. Keep event names tied to decisions and keep all dimensions bounded. Deploy the registry change before enabling the new client.

```sh
node adapters/build-embed.mjs mdviewer /path/to/MDviewer public/observatory.js
# To activate after the notice/collector review, regenerate with the exact endpoint:
node adapters/build-embed.mjs mdviewer /path/to/MDviewer public/observatory.js https://YOUR-WORKER/v1/collect/mdviewer
```

Include the generated **local** script in the public surface after the application entry. For Vite, place it under `public/` and use the app's base URL. For React server layouts, a deferred same-origin script works. For custom/offline builds, include the source in the existing hashed build input rather than mutating artifacts after the service-worker manifest is generated. No dynamic CDN, package publication or runtime import from another repository is required.

The generated script has an empty endpoint until explicitly activated. Only then does it show a native **Usage sharing** control. Consent is per project and collector endpoint, expires after 90 days, and can be withdrawn at any time. There is no persistent analytics identifier. Reconfiguring the destination requires fresh consent.

Once active, explicit application hooks can emit approved content-free events:

```js
// Intent is not success. A print dialog opening cannot prove a saved PDF exists.
globalThis.PulseboardUsage?.track('export.print_requested');
// Call a completion event only after the operation actually resolves successfully.
globalThis.PulseboardUsage?.track('export.pdf_completed');
```

The generic `action.requested` / `action.completed` funnel is reserved for **one primary journey per project**. It counts page sessions with a later completion, not individual attempts. For multiple concurrent or distinct journeys, define a proper flow contract before using the funnel. No conversion result is inferred from unrelated click totals.

Source integrations, activation gates and follow-up work are in `docs/ROLLOUT.md`. The architecture, threat model and expansion boundaries are in `docs/ENGINEERING.md`.

## Deliberate limits

**These are opted-in page sessions, not unique users.** Reloads create new sessions. There is no truthful DAU, cross-device count, returning-user retention or cross-product attribution without a separate identity design. Ad blockers, offline use, declined consent, automated-browser exclusions and dropped requests bias the sample.

Delivery is intentionally at-most-once from the SDK. When the page is hidden, whatever is still queued is handed to the browser with `fetch(..., { keepalive: true })`, so a tracked click that navigates away is not simply discarded; its outcome is unobservable and it is never retried. `navigator.sendBeacon` is deliberately not used, because it attaches cookies and cannot omit credentials. A failed batch is dropped, never replayed after later consent. The collector deduplicates event IDs submitted by other callers. A successful fetch acknowledgment can still be lost. SDK `status()` exposes its local sent/dropped/failure counters; these are not a population-wide loss estimate.

CORS is not authentication. Anyone able to forge HTTP requests can forge browser events or exhaust a project's public event budget. These events are never used for billing, security decisions, rewards or proof of human adoption. Put rate limits/WAF controls in front of public ingestion before widening exposure.

The 1,000-event per-project daily budget limits admitted events, **not your Cloudflare bill**. Rejections still use Worker requests; indexes add database writes; aggregates use reads; all projects share account quotas. Configure account notifications and review real usage. There is no claim that this costs zero.

At the default 15-minute probe cadence, three failures can take roughly 45 minutes to classify an outage. Use a separately hosted, faster monitor for critical availability and the collector itself. Scheduled self-monitoring cannot detect its own provider outage. This initial version exposes incident state in the dashboard; outbound paging is a separate rollout task.

No session replay, DOM autocapture, fingerprinting, IP storage, free-text logs, automatic LLM analysis, tracing backend or experiment assignment is included. The host necessarily processes network metadata and may have separate logs. This kit alone is not a legal compliance or anonymity guarantee.

## Tests and ownership

`npm test` exercises contract rejection, bounded reads, consent state, cancellation, circuit breaking, SQLite transactions, quotas, deduplication, ordered funnels, auth, retention, probes, stale results and installer ownership. Production/host builds still need their own checks.

The code lives under Pulseboard's GPL-3.0-only license. Preserve notices when copying. Integrations retain each host project's licensing and privacy commitments. Review changes in PRs; do not merge with activation settings enabled until the deployment checklist has passed.
