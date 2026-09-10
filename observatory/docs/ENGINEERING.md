# Engineering record

Baseline date: 10 September 2026. Owner: Chris0Jeky. Scope: first-party published surfaces, not employer, university or private-client systems.

## Architecture

```text
Public app (off by default)        Private/local product
  explicit consent                  existing diagnostics / explicit export
  named, content-free events        no injected remote browser collector
           |                                      |
           v                                      | later, reviewed adapter
  HTTPS Worker ingestion <------------------------+
  origin + schema + byte/time limits
  transactional admission budget + deduplication
           |
           v
  D1 / real local SQLite ---> authenticated aggregate API ---> Observatory UI
           ^                         |
  fixed synthetic probes             +-- existing Pulseboard HTTP JSON feed
  retention cleanup                      (operator credential stays server-side)
```

The module is independently runnable and extractable. Pulseboard is the natural source home because its existing purpose is pluggable monitoring. No dependency on its unauthenticated general dashboard API is introduced. A future feed adapter can consume the aggregate endpoint without exposing the read token to arbitrary viewers.

## The questions behind the instrumentation

Reach: which public surfaces receive genuine browser interaction, which links lead to useful action, and which distributions are downloaded? Availability: are public pages reachable and serving the expected product, and is monitoring itself fresh? Experience: which primary actions succeed, fail or take too long? Product: where should the next implementation hour go? Measurement: which events are actually wired, what is missing, and how biased is the sample?

The first version answers reachability, opted-in page-session activity, declared action events and bounded timings. It does not pretend to know user identity, acquisition sources, all human visits or long-term retention. Add dimensions only when they support an actual decision. Route names are curated keys, never raw paths. Release IDs are registered labels, not arbitrary text.

## Trust and privacy model

Untrusted: browsers, event bodies, referrers, URL parameters, internet callers, imported data and external error messages. The collector accepts a closed envelope and uses its own receipt time. A project registry is operator-controlled, reviewed source, not a query parameter. Native/local telemetry promises take precedence over blanket instrumentation.

Protected: dashboard read secret, database, deployment credentials, private application contents. The public ingest endpoint has no secret: hiding an API key in a browser would add no meaningful trust. Browser event authenticity is not guaranteed. Origins shared by GitHub Pages projects do not provide tenant isolation. UI reads require a portfolio-wide bearer token and cannot be framed. Rendered data uses textContent, not HTML interpolation.

Client delivery is fail-open for the product and fail-closed for data collection. A collector outage must not block editing, puzzles or exports. There is no durable offline event queue. Consent withdrawal clears memory, cancels pending work, and prevents failed events being revived. Already received events cannot be recalled by aborting a request.

Taskdeck's existing in-flight failure/re-consent race is addressed in its integration PR. Its v0.3 no-egress policy remains unchanged. MDviewer remains inert until a deliberate future activation updates its current no-runtime-API promise. Developer Lens remains public-showcase-only; no local dataset or portable export is instrumented. IdleHarbor's native executable remains unchanged.

## Measurement semantics

The unit is an observed page-session UUID generated after consent. It is not a person. Event IDs support collector deduplication; page-session IDs reset on reload and inactivity. Sequences preserve client order within a page session, but malicious clients can forge them. A generic funnel counts distinct requested sessions with a later completion; it is not an attempt-level conversion rate. The 95% Wilson interval is descriptive under binomial assumptions, not proof of causality or independence. Tiny samples should trigger a test or interview, not a product pivot.

Use denominators from the same instrumented population. Do not divide opted-in completions by CDN requests, downloads by GitHub profile views, or synthetic page checks by human sessions. Github-proxied/cached SVG requests are not reliable individual viewers. Release asset downloads are not installations. Never describe stars, line counts or traffic as demonstrated product value.

## Budgets and data lifecycle

At default settings each registered public project admits at most 1,000 event attempts per UTC day. Batches contain at most 20 events and 16 KiB. The SDK holds at most 100 events, permits 120 requests per mounted page, and opens its failure circuit after three failures. These are defensive product limits, not a billing guarantee or anti-abuse service.

Admission and event writes share a D1 batch transaction. A random receipt is written only if the reservation succeeds; each insert checks that exact receipt. This avoids the common bug where a rejected reservation is followed by unconditional inserts. Duplicate event IDs still spend admission budget, intentionally conservative. Events expire after 14 days and probe history after 30 days. No longer-lived rollup silently preserves deleted raw data.

Queries are bounded to a seven-day window and indexed for time and session flow. The UI refreshes manually to avoid a dashboard multiplying D1 reads in the background. Check D1's reported rows_read / rows_written in the actual account before changing caps or refresh frequency. Prefer aggregate tables and explicit retention policy before increasing volumes substantially.

## Failure modes to rehearse

Collector disabled; invalid/missing read token; absent database migration; wrong origin; body too large; malformed JSON; unknown event after a client release; full daily budget; duplicate delivery; browser offline; consent withdrawn during a request; GPC toggled; storage unavailable; stale probe schedule; 200 response containing the wrong application; unavailable primary site; fallback-site confusion; monitoring provider failure; dashboard request completing after disconnect; local edits to a vendored SDK; and installing through a symlink outside the target repository.

The schema and browser tests cover most of these locally. Full host builds, browser accessibility checks, actual Cloudflare D1 behavior, real deployment credentials and production traffic remain release gates, not assumed successes.

## Next modules, in priority order

1. **Action journeys.** Wire real success/failure seams, especially export completion, card generation, puzzle completion and share actions. Add cancellation/abandonment semantics without equating a tab close to frustration. Keep puzzle IDs curated and no save content.
2. **Reliable alert delivery.** Add a durable notification outbox with stable incident IDs, retry limits, cooldowns and recovery notices. Test duplicate scheduled execution, failed delivery and independent collector monitoring. Do not call a dashboard state a delivered page.
3. **Distribution and acquisition.** Snapshot GitHub traffic with server-side credentials, preserve date-grained rows rather than summing overlapping windows, and record release asset download deltas separately. Add opt-in referral *categories*, not arbitrary referrer URLs. An allowlisted campaign vocabulary should be reviewed before use.
4. **Operational telemetry.** Reuse Taskdeck's existing OpenTelemetry metrics/traces. Use mature collector/backends for distributed traces and error symbolication rather than inventing them here. Keep browser product events separate from authenticated server events; no client-submitted severity may page the operator directly.
5. **Release intelligence.** Authenticated deploy markers, registered build fingerprints, control windows, last-good baselines, minimum sample checks and rollback links. A temporal correlation is not a proven release regression.
6. **Data quality.** Schema-version coverage, rejected-event counters that cannot become an amplification attack, sampling metadata, freshness, event ownership and an instrumentation catalogue generated from source. Add a CI test per critical user journey proving exactly one success event.
7. **Performance.** An opt-in official web-vitals adapter with route/release buckets and tested lifecycle behavior. Do not label a homemade PerformanceObserver callback a complete INP implementation. Browser long tasks and payload metrics should be sampled and bounded.
8. **Experiments and longitudinal cohorts.** Only after sufficient traffic and explicit consent/identity decisions. Assignment integrity, sample-ratio checks, sequential-testing rules, guardrail metrics and pre-registered stopping criteria matter more than adding an A/B toggle.
9. **Operator assistance.** Evidence-linked, read-only summaries over aggregates, with provenance and uncertainty. No automatic code changes or user-level profiling from speculative LLM explanations.

## External references checked

- OpenTelemetry sensitive-data handling: https://opentelemetry.io/docs/security/handling-sensitive-data/
- OpenTelemetry browser instrumentation: https://opentelemetry.io/docs/languages/js/getting-started/browser/
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 billing observability: https://developers.cloudflare.com/d1/observability/billing/
- Cloudflare Worker pricing: https://developers.cloudflare.com/workers/platform/pricing/
- ICO storage/access exceptions: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/

The UK statistical-purpose exception is conditional, not a universal exemption for analytics. This rollout chooses explicit opt-in because the products have existing privacy promises and potentially international audiences. Deployment still requires review of the actual notices, data use, service providers and applicable rules.
