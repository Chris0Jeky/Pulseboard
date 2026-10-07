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
