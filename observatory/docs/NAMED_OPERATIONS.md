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
or lost delivery may explain them. Explicit orphan-terminal reporting and actual
Alibi hook-order qualification remain tracked in #73. Adding that missingness
measure needs a compatible/versioned reader change, not an unannounced field in a
closed schema. No cross-route matching is inferred to hide missing evidence.

The aggregate path reads legacy opt-in `events`, not the newer `product_events`
journey path. Passing synthetic/SQLite tests does not prove a current hosted Alibi
installation emits this legacy contract in the required order.
