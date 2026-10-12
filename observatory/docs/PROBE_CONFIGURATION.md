# Probe configuration and product observations

Targets declaring `probe.binding` require that service binding to expose a callable
`fetch`. A missing or malformed binding is monitoring infrastructure that is
**unconfigured**, not evidence that the product is down. Such a target is skipped:
no public-hostname fallback, no health-history row, and no change to the product's
failure/success streak, incident opening time, or last real observation time.
Existing observations remain historical evidence and become stale normally.

`GET /readyz` exposes an additive `probes` diagnostic:

```json
{
  "configured": ["mdviewer"],
  "unconfigured": [
    {"project": "alibi", "reason": "service_binding_unavailable"}
  ]
}
```

The example is abbreviated, not the complete registry. Only fixed registry IDs
and a fixed reason are returned, never tokens, exception text or remote content.
These diagnostics do not contact targets. They are reported separately from
`ready` and its HTTP status, which retain the existing collector schema and
collection-policy semantics. A ready collector does not certify probe coverage.
The scheduler's `probeAll()` also returns the same configuration report.

Once a callable binding is restored, ordinary measurements resume. Failed HTTP
responses, missing markers and exceptions from a configured binding remain real
failed probe attempts and drive the existing hysteresis. Direct targets continue
to use the supplied transport. No target, admission list, schema or deployment
configuration changes in this fix.

Local runners without Cloudflare service bindings now report those targets as
unconfigured. Tests requiring successful bound measurements supply explicit fake
bindings, rather than relying on the fallback this fix removes. Run:

```sh
cd observatory
node --test tests/probe-configuration.test.mjs tests/core.test.mjs
npm test
```

These tests use isolated SQLite and synthetic transports, not a live deployment.
