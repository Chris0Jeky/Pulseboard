# Aggregate receipt precision (#112)

New writes to `statistics.received` retain the UTC day's midnight in integer
milliseconds, not the precise last-write time. Inserts and conflict updates use
the same SQL expression, inside the existing admission transaction. The row's
project/day/event/route/release identity and its count are unchanged.

## Compatibility and evidence

This is a write-calculation correction compatible with database schema 5, not a
new table or wire contract. Readiness checks still find the existing column.
`readStatistics` groups and filters by `day`; aggregate retention also uses `day`.
Neither uses `received` for freshness. The read response's `generatedAt` remains
the read time, not the arrival time of a specific request.

The independent `hour` dimension continues to use the original receipt time to
increment an hour bucket. It is a separate marginal total, not joined to event,
route or release rows. Product events, legacy session events, probes and Voices
are not modified by this aggregate-only correction.

`tests/statistics-precision.test.mjs` drives real collector requests and SQLite
for Alibi and MDviewer. It covers inserts, same-day upserts at different hours,
midnight rollover, unchanged event/dimension totals, unchanged budget use and
rejected origins. A third case distinguishes a touched historical row from an
untouched one. All three failed on precise milliseconds before the correction.

## Rollout and remaining history

Merging follows the existing Observatory deployment workflow. It changes no
consent, admission list, retention window, notification or budget setting.
Verify the deployed revision before expecting new writes to use day precision.

Old rows not subsequently updated can still contain precise last-write times.
This code change alone does not certify removal of those times from the hosted
D1 database or backups. Keep #112 open until a separately reviewed historical
cleanup has been executed and verified, or those rows' expiry has been verified
under the existing retention policy. Do not create traffic to overwrite them.

Reverting the code makes later writes precise again; it cannot recover precision
already discarded. Existing counts and dimensions remain intact in either case.
Sparse repeated reads can still reveal changes, and hour totals still reveal
activity by hour. This is removal of one join key, not an anonymity guarantee or
an assessment of provider request metadata and logging.

## Reviewed historical cleanup procedure

The follow-up to #205 supplies two **manual** SQL files under `maintenance/`,
outside `migrations/`. Nothing in startup, scheduled retention or deployment runs
them. Merging the files does not change historical data. They target the existing
schema-5 `statistics` table only; the marker is not incremented.

First verify that the day-precision writer is deployed. Select and independently
confirm the intended database/account/environment, using the existing approved
operator access. Rehearse on an authorized disposable copy before any live run;
keep that copy within the existing privacy/retention policy. Do not log tokens,
raw rows or other tables. A new long-lived backup is not part of this procedure.

The exact commands from `observatory/`, for an already approved D1 target, are:

```sh
# DB must be set explicitly to the reviewed database name or id. These are manual commands.
npx --no-install wrangler d1 execute "${DB:?Set the reviewed database}" --remote --env="" \
  --file maintenance/statistics-received-audit.sql --json
# Proceed only after schemaVersion == 5, invalidRows == 0, and the target/operation is approved.
npx --no-install wrangler d1 execute "${DB:?Set the reviewed database}" --remote --env="" \
  --file maintenance/statistics-received-cleanup.sql --json
npx --no-install wrangler d1 execute "${DB:?Set the reviewed database}" --remote --env="" \
  --file maintenance/statistics-received-audit.sql --json
```

The audit emits five aggregate values, no individual timestamps. `preciseRows`
counts valid rows retaining sub-day precision; `invalidRows` counts noninteger,
negative, out-of-range or day-inconsistent timestamps. An absent marker reads
null. A wrong schema marker or **any** invalid row makes the whole UPDATE a no-op,
including otherwise valid rows. Missing tables/columns cause an SQL error, not a
repair. Stop on either outcome: zero affected rows alone is not a success signal.

The single UPDATE is atomic and idempotent, changes only `received`, and preserves
row identities, counts, dimensions, all other tables and the schema marker. The
local fixture verifies byte-equivalent reader objects across every supported
window and every seeded non-target table. A deliberate statement failure rolls
back every update. These SQLite tests do not substitute for a hosted execution
receipt or prove physical erasure from database pages, replicas or backups.

Require a successful execution and a post-audit with `schemaVersion == 5`,
`invalidRows == 0` and `preciseRows == 0`. Record source revision, target identity,
execution time and both audit summaries without secrets. In a quiescent rehearsal,
`totalRows` and `totalCount` must be identical before/after; during live collection
or retention, independent writes/deletes can change them. Do not mislabel those
changes as cleanup effects or claim exact reconciliation without a coordinated
quiescent window. The write-time guard rechecks eligibility in the UPDATE, not
just in the earlier audit. Operator coordination is still required.

Precision removal is intentionally irreversible: there is no SQL rollback that
recreates discarded milliseconds. Restoring an older snapshot would also restore
its precision and requires a separately reviewed recovery decision. The unchanged
retention policy provides an alternative: verify that all pre-fix precise rows
have expired instead. Keep #112 open until actual hosted cleanup or expiry is
verified. This maintenance pass has not executed either SQL file against D1.
