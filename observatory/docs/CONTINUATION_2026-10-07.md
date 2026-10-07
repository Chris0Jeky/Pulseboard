# Continuation checkpoint: 2026-10-07

Base: main `af0b4172`, exact reconstructed tree
`028c81f676eb75c7bee2f9fb9aeacf275e6ea505`, 617 baseline tests. This is a dated
record, not a live status page. PR metadata and checks remain authoritative.

## Shipped improvements

**#208, merged `249b6324`: query scalability.** Repeated correlated scans were
removed from named operations and generic paired flows without a schema/index
migration or wire-shape change. The same 3,000-event synthetic read moved from
2,347 ms to 19.2 ms after the first repair. The final nine bounded profiles cover
1/7/14-day reads across single-session, many-session and duration-heavy traffic.
These local measurements are not D1 billing, memory or production latency proof.
See [QUERY_BUDGETS.md](QUERY_BUDGETS.md). Final head `fb0268df`: 656 local tests,
Observatory 37563164460 and Desk browser 37563164447 passed. Sequence ties retain
an explicit storage-order caveat, not a claim of verified client chronology.

**#209, merged `ed55985b`: private import boundaries.** Invalid files are validated
before output directories or SQLite are created. One checked file descriptor
bounds reads and rejects replacement/growth; fixed CLI failures do not echo
private content. Existing identity-conflict triggers remain unchanged. Final head
`88655b8f`: 672 local tests, Observatory 37563779927 and Desk browser 37563779931
passed. Destination directories must still be trusted; arbitrary hostile
filesystem changes and rollback of every storage failure are not certified.

**Offline Actions converter, this change.** Explicit run-attempt/job-page exports
become the same private receipt contract. Numeric identities, head and attempt
consistency, pagination, status, time and retry-chain checks fail closed. Parallel
job seconds and observed job-envelope duration stay distinct, and their limitations
survive import and question-card export. Preview is read-only; explicit output is
create-only, not an implicit import. See
[the adapter guide](../run-receipts/GITHUB_ACTIONS.md). Forty-two focused converter
and file-publication tests plus the full 714-test suite pass locally. One selected
API projection from the existing Alibi mapping produced 1,532 runner-seconds and
one private receipt, with a duplicate on reimport and no cost or verified outcome.
Its private source projection/database are deliberately absent from this repo.
Current-head hosted checks and the merge receipt belong in the PR discussion.

## Remaining acceptance work

#19 still needs actual hosted D1 parity, rows-read/query-time and memory evidence,
and coordinated rollback/rotation proof. The local profiler must not be used to
justify higher admission limits. #23 still needs broader provider history and
independent accepted-outcome verification; manual JSON is not authenticated
provider evidence and no billing amount is inferred.

#73's orphan-terminal reporting and current host hook-order evidence remain
separate. #112's historical cleanup/expiry has not been executed or certified.
#122's historical missing-event root cause remains unproved. The other native
integration, operational, privacy and budget boundaries in
[the earlier checkpoint](MAINTENANCE_2026-10-07.md) were not closed by this pass.

No credentials, collection, consent, admission budgets, retention settings,
HUMAN_TODO decisions or global GitHub mappings changed. No hosted resource or
historical data-cleanup operation was created. Existing approved auto-deployment
continues unchanged. Review was a separate self-review; no independent subagent
review is claimed. No Windows/browser/hosted parity claim is inferred from local
Node/SQLite tests or a successful deployment.
