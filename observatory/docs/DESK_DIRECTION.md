# Direction: a useful desk for a growing portfolio

**Last reconciled: 15 September 2026**

## Current status

The first operating slice now exists rather than being only a design:

- the Cloudflare Worker/D1 Desk is hosted with authenticated aggregate reads;
- deterministic scenario replay is publicly explorable without credentials;
- seven public probe targets and a separate hosted-edge canary are configured;
- collection is enabled only for the reviewed Alibi pilot through the project allowlist;
- the first consented Alibi events and a withdrawal check were recorded on 10 September 2026;
- every other project adapter remains inert, and collection activation still requires an explicit project decision;
- route/release context work remains bounded by closed registries and consent, including the current Alibi follow-up;
- Security Watch, native Taskdeck/Lens producers, broad GitHub ingestion, paging, remediation, and portfolio-wide collection are not shipped.

This status does not erase the known limits in `HOSTING.md`: probe scheduling and public-edge behavior need their own receipts, cold paths can cross client timeout budgets, and two admitted events do not establish product efficacy or representative usage.

## The thesis

Pulseboard should reduce the effort between shipping something and understanding what deserves attention. A portfolio owner needs product signals, reliability, development context and operating costs in one place, but not another dashboard that rewards staring at graphs. The output should often be a better question, a small investigation or a deliberate decision to leave a project alone.

The distinctive unit is an **evidence-backed next check**. Keep its time window, source, numerator, denominator, limitations and proposed action together. Show raw observations, derived patterns and hypotheses differently. Let specialist tools own detailed tracing, development analysis and task execution.

## Useful workflows

**Alibi:** notice a release-cohort failure change; inspect route mix and test a real puzzle-completion journey before calling it a regression. Later, compare tutorial completion and accessibility without collecting puzzle answers or identifying players across products. The current pilot establishes the consent/admission boundary; it does not yet establish this complete journey.

**CommitAtlas:** distinguish a failed SVG render or export from a low-traffic day. Bring named-workflow and release context into the desk. Export a separate reviewed public probe capsule only when its denominator and expiry can be displayed honestly.

**Taskdeck:** remain local-first. Local installation health, backup verification and opt-in operation receipts can eventually enter a private adapter. A desk observation becomes a proposal card, not a remotely issued instruction.

**Client work:** operate a small client portfolio with explicit tenant boundaries, backup checks, per-client runbooks and a scoped monthly field note. Do not simply add client names to the current single-operator deployment. Tenant isolation, auth and retention are prerequisites, not a pricing checkbox.

**Agent-heavy workflows:** bring CI duration, cancelled runs, model spend, failed automations and accepted outcomes into a private operations view. Compare cost per verified outcome, not commits or tokens as a productivity score. Exact provider receipts and missing coverage matter more than decorative trend lines.

**Research and simulations:** surface reproducible run receipts, experiment IDs, compute budgets and failure states. Developer Lens Lab retains authority over method validation. A fascinating chart must still say when it is a synthetic run.

## Delivery order

1. **Complete one real journey loop.** The consent → named operation → admitted event → aggregate evidence seam is live for basic Alibi page events. Add one meaningful product journey and one intentionally broken path, then prove the Desk distinguishes failure from disabled collection, stale probes and missing context.
2. **Finish hosted-operability proof.** Keep D1 query plans, retention, browser headers, rollback, credential rotation, cold-path behavior and unattended scheduling under dated receipts.
3. **Add read-only GitHub release/workflow evidence.** Use explicit mappings, bounded backfills, ETag caching, least-privilege permissions and truthful rate-limit states.
4. **Add journey checks and an incident journal.** Keep scheduled samples, user outcomes and operator declarations separate. Decide when a notification is worth sending rather than treating every rule match as an alert.
5. **Add reviewed native Lens and Taskdeck bridges, then the minimal public consumer.** Preserve each producer’s authority and privacy contract.
6. **Add private cost/run receipts and bounded specialist adapters only where a real question justifies them.** Introduce durable aggregate rollups before raising volume.

## Expansion designs

### Release notebook and reversible investigations

Attach deployment timestamps, immutable commit references and an operator note to a release. Pin a snapshot at the start of an investigation. Record the suspected cause, alternative explanations and the check that would disprove it. Close the loop with what happened. Never present temporal proximity as causal attribution.

A proper replay system stores versioned aggregate snapshots plus rule versions, not an ever-growing stream of private events. Keep deletion and retention explicit. The current replay is synthetic only; it is a design and test harness for this path.

### Narrow specialist adapters

Do not implement a general OTLP collector, Prometheus database or log search engine inside Pulseboard. A bounded adapter should return a versioned evidence envelope, coverage/freshness and an allowlisted deep link to the specialist tool. Separate read credentials per source, cap cardinality and bytes, and treat errors as missing rather than zero. Prometheus quantiles cannot be combined by averaging them.

OpenTelemetry Collector can remain the processing gateway when tracing is needed. Evaluate Prometheus for service metrics and a dedicated tracing backend only after actual instrumented workloads justify their operational cost. These are architectural options, not installed integrations or endorsements based on a benchmark here.

Primary references: https://opentelemetry.io/docs/collector/architecture/ and https://prometheus.io/docs/practices/histograms/ .

### An opportunity ledger, not a portfolio score

Let the operator pin a question to a project: is anyone getting value from this, is the maintenance burden rising, or is this a deliberate hobby? Track the agreed success evidence and the time/cost window. Support keep, improve, pause and archive as human decisions. Never infer that a quiet research project is failing because it has fewer visitors than a public utility.

### Security Watch

Security Watch can admit bounded security receipts and conservative derived rules into a separate evidence lane. It must not become a generic scanner launcher, attack console or automatic blocker. Source onboarding, retention, replay resistance, tenant boundaries and operator authority need to be proven before production traffic or notifications are enabled.

### Ambient mode and public slices

A later wallboard can be calm and nearly motionless, with large state changes and no flashing tickers. Public cards should consume reviewed capsules, not the private Desk endpoint. No token in a URL, no last-good stale state painted green, and no secret operator notes hidden in exported SVG metadata.

### Preserve the workbench selectively

The existing pluggable feeds are useful. First inventory their security and gate debt, then create one read-only feed-to-evidence adapter. Decide whether shared concepts justify migration after that slice works. A wholesale framework rewrite before proving this seam would discard working capability for little gain.

## Design constraints

Compact graphite panels, one restrained accent, readable tabular numbers, quiet motion and explicit evidence drawers. No stock-photo hero or chart animation in the critical path. Humour belongs in small labels, not incident diagnoses. Native HTML controls and SVG charts are enough for the current surface; keep the tested asset budget until a concrete interaction requires more.

## Non-goals

Pulseboard is not currently:

- a production tracing or log-search backend;
- an automatic incident pager or remediation system;
- a hosted multi-tenant client portal;
- a source of truth for development analysis, task execution or public portfolio content;
- a cross-product user identity system;
- a universal project score, productivity score or causal attribution engine.

Those boundaries are product features. They keep the Desk useful without turning a small evidence system into an ungoverned operations platform.
