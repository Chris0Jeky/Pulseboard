# Security Watch

Private security evidence for the Pulseboard Desk. A recent heartbeat is useful; it is not a clean bill of health.

This extends the merged Observatory/Desk stack (#15–#17) and epic #35. It does not replace the portfolio, consent-gated browser SDK, existing public probes or FastAPI/Vue workbench. The implementation is a small security receipt service, not a SIEM, WAF or packet sensor.

## Start here

From a complete repository checkout, on Node 22.16 or newer:

```sh
cd observatory
npm test
npm start
```

The local server stays on `127.0.0.1:8788`. It creates the additive Watch tables and a separate ephemeral Watch read token. Collection and security ingestion both default to off. Supplied secrets are never printed. Local startup does not scan your products.

Protected endpoints:

| Route | Credential | Purpose |
| --- | --- | --- |
| `GET /v1/watch/readyz` | `WATCH_READ_TOKEN` | Check Watch schema/configuration readiness |
| `GET /v1/watch/snapshot` | `WATCH_READ_TOKEN` | Sources, findings, aggregates and latest 200 minimised receipts |
| `POST /v1/watch/events/<source>` | That source's token | Admit a closed batch of server receipts |

The UI and producer/tool adapters are separate changes in the same stack. See [architecture](docs/ARCHITECTURE.md), [research and tool choices](docs/RESEARCH.md), and [activation/runbook](docs/RUNBOOK.md). Their presence in a plan is not a claim that your fleet is connected.

## Configure one isolated source

Copy `sources.example.json` to a private location outside the repository. Replace the deliberately invalid `REPLACE_...` token with a unique random secret, and set the project, environment, bounded asset aliases and allowed event kinds. A token belongs to exactly one source. Do not reuse the ordinary Desk read token, the Watch reader or another producer's token.

Set these process variables through your secret manager or local private shell:

```text
WATCH_READ_TOKEN=<independent random secret, at least 32 characters>
WATCH_SOURCES_JSON=<JSON array matching sources.example.json>
WATCH_ENABLED=false
```

`WATCH_SOURCES_JSON` contains credentials: never put it in a public `wrangler.vars`, a browser bundle, a command-line URL, a screenshot, CI output or a Git commit. Readiness rejects malformed configuration, including placeholder secrets. First use a disposable local/test database. Enabling requires both `WATCH_ENABLED=true` and the individual source's `enabled: true`; neither changes browser analytics consent.

A batch is `{"schema":"pulseboard.security-events/1","events":[...]}`. Its events carry a UUID v4, integer Unix milliseconds, a permitted kind and usually a configured asset alias. Heartbeats have sampling/loss metadata instead of an asset. Unknown fields are rejected, not silently retained. The request needs a source-specific Bearer token and JSON Content-Type. Browser Origin headers, query parameters, redirects and raw payload logs are not part of this contract.

## Boundaries worth keeping

The service authenticates a producer credential, not the truth of its report. A compromised app can lie inside its own scope. It cannot use its producer token to read the fleet or submit as another source. Keep independent provider and host evidence for stronger investigations.

The current ledger deliberately excludes IP addresses, user identities, URLs, request/response bodies, headers, stack traces, query strings and arbitrary messages. Store detailed diagnostics in a separate access-controlled log backend with a deliberate retention policy. No Watch evidence belongs in public CommitAtlas cards or ordinary public-pulse exports.

A finding is an observation with a next check. It is not a confirmed intrusion, a persistent incident, an automatic block or permission for an agent to change production. Live rollout, real integrations, paging, scanner orchestration and deeper network backends remain explicit follow-on gates.
