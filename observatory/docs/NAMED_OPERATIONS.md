# Named-operation measurement notes

The optional `operations` extension of `pulseboard.portfolio/2` reports registered,
version-1 start/terminal contracts separately from generic paired flows. The
registered `puzzle.solve` contract uses `puzzle.started`, `puzzle.completed` and
`puzzle.failed`; it does not add puzzle identity to the legacy event payload.

The first terminal before the next start resolves an attempt within the same
project, session, route, release and selected half-open receipt-time window.
Attempts reconcile as completed + failed + open. Completion divides completed by
all attempts, not by known outcomes only. Release totals reconcile to the whole.

`retries` counts starts following a failed or open attempt, not a new start after
success. These are retry candidates: without puzzle identity, a later start may
be a different puzzle. Before the #73 accounting correction, this field counted
every later start. Do not compare that historical field without its producer
revision. Wire keys and the version-1 operation event vocabulary are unchanged by
this calculation correction; existing strict readers can still read the result.

A terminal on another route or without an in-window start does not resolve an
attempt. Open attempts are not verified failures: withdrawal, abandonment, outage
or lost delivery may explain them. V2 does not report unconsumed terminal counts;
the explicit v3 negotiation below adds that missingness measure without changing
the closed v2 schema. Actual Alibi hook-order qualification remains tracked in #73.
No cross-route matching is inferred to hide missing evidence.

The aggregate path reads legacy opt-in `events`, not the newer `product_events`
journey path. Passing synthetic/SQLite tests does not prove a current hosted Alibi
installation emits this legacy contract in the required order.

## Explicit missingness in portfolio v3 (#73)

`GET /v1/portfolio?days=7&version=3` negotiates `pulseboard.portfolio/3`.
Omitting `version` or selecting `version=2` keeps the v2 operation shape; old
clients receive no unannounced fields. Invalid or repeated versions return 400
after authentication and before database access. The read-model option is
`readPortfolio(db, { version: 3, ... })`; its default remains 2. The registered
operation event vocabulary is still version 1.

Version 3 requires `unmatched: { completed, failed }` on every operation and
operation release. Each is a nonnegative integer count. For each terminal kind,
the number of admitted terminal events in the selected window equals paired
outcomes plus unmatched events. Attempts still reconcile as completed + failed
+ open; unmatched events are not added to attempts or to the completion/failure
denominator. This is a description of missing pairing evidence, not a diagnosis
of extra failed user actions.

The counts include orphan terminals without an in-window start, extra terminals
after the first outcome, a terminal at a start's sequence, and unmatched route,
release or session partitions. Which explanation caused a particular unmatched
event is unknown. Window membership uses receipt time; pairing uses sequence.
First-storage-order resolution for conflicting terminal ties remains as documented
in QUERY_BUDGETS.md. No raw event, session, puzzle or receipt identity is returned.

Terminal-only releases are retained in v3 even with zero attempts. The 64-row
release ceiling and `other` fold reconcile both paired and unmatched totals;
v3 chooses visible release rows by attempts plus unmatched event count. V2 retains
its previous attempts-only selection and excludes terminal-only release rows.
The shared query continues to use grouped sequence windows, with no per-start
correlated scan. SQL reference: [SQLite window functions](https://sqlite.org/windowfunctions.html).

The Desk validator accepts v2 and v3, but v3 with missing, extra, negative,
unsafe or inconsistent unmatched counts is refused. Missing detail in v2 means
**unavailable**, not zero. The public pulse exporter accepts a validated v3
snapshot and still projects only selected probe status and sampled check counts.
Operation evidence never enters that public projection.

The first release adds the opt-in API and dual-version validator; the follow-up
opts the Desk into v3 and adds its inspection and reviewed-next-check path. Neither
changes collection, the event registry, schema 5, retention or admission budgets.
Current Alibi host hook-order qualification remains separate; these calculations
use legacy `events`, not product journeys or aggregate-only statistics.
