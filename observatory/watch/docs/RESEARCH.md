# Research and build-versus-integrate decisions

Reviewed 2026-09-10. Primary documentation below informed the architecture; no production targets were scanned. This is an implementation decision record, not an assurance certification or an exhaustive tool benchmark. Recheck versions, licences, plan entitlements and resource cost when onboarding a real deployment.

## Sources that changed the design

| Source | Relevant point | Watch decision |
| --- | --- | --- |
| [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | Application context adds evidence infrastructure alone lacks; logs cross trust boundaries and can be forged/replayed; sensitive data and failure modes need explicit handling | Separate server receipts from browser analytics, minimise fields, test loss/replay, keep the app alive when telemetry fails |
| [OpenTelemetry: handling sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/) | Telemetry can contain sensitive attributes and needs deliberate minimisation/redaction | Allowlist before storage; do not dump traces into the small receipt database |
| [Cloudflare WAF Security Events](https://developers.cloudflare.com/waf/analytics/security-events/) | Security Events cover flagged/mitigated traffic and may be sampled, rather than representing all traffic | A future WAF feed must retain its coverage and sampling semantics; never call WAF events total usage |
| [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) | Provider-side execution logs offer a different observation point from browser code | Prioritise a read-only provider adapter for published Workers, subject to actual account capability |
| [ZAP baseline scan](https://www.zaproxy.org/docs/docker/baseline-scan/) | Passive analysis follows crawling; the crawler still makes requests | Run reviewed baseline scans in staging with exact scope and budgets; do not describe passive analysis as zero traffic or run it automatically against production |
| [Trivy documentation](https://trivy.dev/docs/latest/guide/) | Existing tooling covers software/container/configuration security reports | Consume sanitised scanner output instead of writing a vulnerability database or vulnerability scanner |
| [Falco documentation](https://falco.org/docs/) | Runtime security is a specialised source of host/container events | Prefer a bounded Falco adapter when there is an actual Linux/container estate; it is not an agent for Cloudflare Workers |
| [Cilium Hubble](https://docs.cilium.io/en/stable/observability/hubble/) | Network flow observability integrates with Cilium | Relevant for a future Cilium-backed cluster, not a reason to introduce Kubernetes for this portfolio |
| [Zeek documentation](https://docs.zeek.org/en/current/about/index.html) | Network analysis is a specialist workload with deployment/traffic-access requirements | Leave packet/network analysis to a suitable sensor and project a few reviewed findings |
| [Wazuh use cases](https://documentation.wazuh.com/current/getting-started/use-cases/index.html) | A broader host-security platform can consolidate several endpoint use cases | Consider it instead of accumulating many bespoke host agents; avoid installing a heavy stack before a host pilot justifies it |

## What to build here

Build the useful portfolio-specific layer: explicit project/source identity, narrow evidence contracts, independent coverage, conservative rules, an operator desk and reviewed investigation packets. This fits the existing no-build Observatory and keeps the incremental runtime dependency count at zero.

Implement bounded adapters that are easy to test offline: a JavaScript server receipt producer, a manual exact-scope HEAD posture checker, a SARIF projection reader and an owned-Linux listener inventory. These establish end-to-end contracts without claiming comprehensive network monitoring.

Do not build a new SIEM search engine, vulnerability database, packet dissector, endpoint detection product, edge firewall or generic arbitrary-URL scanner. Their operational/security burden would outweigh the current portfolio benefit. Keep raw logs/traces in a dedicated restricted backend. An OTel Collector plus the operator's chosen log/trace store is a candidate path, not a bundled or configured deployment in this PR stack.

## Recommended rollout by environment

**Published static sites / Workers:** start with server/provider request and error evidence, known public/private-route expectations, certificate/HTTP policy observations, and security/reliability limits. Browser telemetry alone misses clients that never execute the SDK. Add WAF analytics only with the correct provider scopes, sampling metadata and plan support. Instrument only routes you own; do not attach privileged headers to third-party URLs.

**Application servers:** add authentication and authorization outcomes, named route aliases, controlled egress categories and failure counters at meaningful server seams. Do not label every 4xx as malicious. Keep response bodies and customer data out of the security receipt contract. Trace correlation can be added later with carefully scoped, non-user identifiers and a private backend.

**Local-first desktop products:** keep host monitoring local by default. Taskdeck and NavSentinel should not acquire covert remote reporting because a portfolio dashboard exists. A user-controlled local export/preview can supply evidence later; that requires product-specific design and integration review.

**Owned Linux hosts:** begin with the explicit listener policy check and a real inventory of services. A wildcard bind is a lead to inspect, not proof of Internet exposure. Only after that pilot choose between Falco, Wazuh or existing host controls. Packet or flow inspection must reflect what the host can actually see, with clear placement and encryption limits.

**CI and supply chain:** consume existing scanners and security checks with immutable commit/run references. Require scan completion and scope before claiming a clean result. Sanitised SARIF ingestion is available in the adapter slice; vulnerability lifecycle, suppression policy, successful-run reconciliation and automatic GitHub security ingestion are separate work.

## Good later expansions

Map public endpoints from declared route/OpenAPI inventories and compare them with deployed observations. Maintain an inventory of owners, environments and verification expiry. Add dependency/secret/configuration checks, certificate-expiry evidence, expected egress manifests, backup/restore exercises and collector self-monitoring. Use release/deployment evidence from the existing Desk work to propose investigation leads, not causal verdicts.

A future incident journal should group noisy observations, preserve onset/recovery evidence, make acknowledgement distinct from remediation, expire suppressions and place a strict budget on interruptions. A future Taskdeck bridge can create a reviewed proposal, never an automatically executed repair. A public CommitAtlas surface should stay limited to explicitly approved aggregate status; exposed endpoints, source IDs and security findings remain private.
