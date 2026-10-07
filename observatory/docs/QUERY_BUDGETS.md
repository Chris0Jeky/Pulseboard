# Local query-budget evidence (#19)

This is a local, synthetic scalability gate, not a hosted D1 certification. It
changes no admission, retention, schema, index, deployment policy or host mapping.
The public `pulseboard.portfolio/2` fields and its registered operation vocabulary
remain unchanged.

## Reproduced bottlenecks and repair

On Node 22.16.0 / SQLite 3.49.1, a 3,000-event single-session fixture took 2,347 ms
to read; 2,340 ms was the named-operation statement. EXPLAIN showed five correlated
terminal subqueries, each searching the same project receipt-time window. The
terminal expression was reevaluated for each aggregate. Replacing it with grouped
sequence windows reduced the same fixture's read to 19.2 ms (13.4 ms in operations).

A subsequent 14,000-event, many-session profile found the generic paired-flow
statement still rescanning. Its existence test is exactly equivalent to
`MAX(completion sequence) > MIN(start sequence)` within each project, session,
route, release and receipt window. Grouping those values removed that repeated
scan too. No index hints, schema migration or stored rollup was needed.

Named operations collapse equal sequence positions, then inspect the following
position and whether a later start exists. A terminal at the start's own sequence
cannot resolve it; a terminal at the next start's sequence cannot resolve the
previous attempt. Repeated starts still contribute open attempts and retry
candidates. Only the first subsequent terminal resolves the final start at a
position. A start after completion is not a retry. Release folding and completion
denominators are unchanged.

Conflicting terminals with the same sequence remain ambiguous client evidence.
The old query's tie was unspecified. The grouped query uses the first stored
terminal at that sequence, not receipt-time chronology or a claim of verified
success. No raw identity is returned. Proper clients issue increasing sequences;
this tie break does not authenticate them or identify a puzzle.

## Reproduce the bounded profile

From `observatory/`, without installing dependencies:

```sh
node tools/profile-portfolio.mjs > local-query-profile.json
node tools/profile-portfolio.mjs --events-per-day 60 --shape many-sessions
node --test tests/operation-query-plan.test.mjs tests/portfolio-profile.test.mjs
npm test
```

The tool creates only disposable in-memory SQLite databases. It accepts no
endpoint, credentials, database path or production data. Each shape seeds 14 days
at no more than the existing Alibi daily admission cap. It checks 1-, 7- and 14-day
reads, validates the actual portfolio contract and reconciles event totals before
reporting timings, response bytes, per-statement returned rows and query plans.
Source-file SHA-256 values, Node/SQLite versions and the synthetic clock accompany
the report. Redirect the output deliberately; the command itself writes no files.

A measured final run at 1,000 events/day (14,000 seeded rows per shape):

| Shape | 1-day read | 7-day read | 14-day read | 14-day response |
| --- | ---: | ---: | ---: | ---: |
| Single session | 7.57 ms | 31.33 ms | 62.32 ms | 6,713 bytes |
| Many sessions | 4.59 ms | 28.16 ms | 57.33 ms | 6,720 bytes |
| Duration-heavy | 4.44 ms | 26.51 ms | 53.66 ms | 6,594 bytes |

These are single local observations, not latency percentiles or universal budgets.
The whole process maximum RSS was 163,168 KiB, including Node, fixture creation,
all three databases in sequence and instrumentation. It is not isolated query
peak memory and cannot establish compliance with a Worker memory limit.
`seededRows`, `windowEventRows` and statement `resultRows` are distinct counts;
none is D1's `rows_read`. The report leaves `d1RowsRead` explicitly null.

The CI gate is semantic and structural, not a flaky wall-clock threshold. Seeded
independent sequence and generic-flow oracles check outcomes, retries and
partitions; explicit duplicate-sequence cases check strict inequalities. EXPLAIN
must show no correlated scalar scan for either pairing path. Failed assertions
were observed before both repairs. Existing percentile, release-folding and
transaction tests remain part of the full suite.

## Hosted work still open

Issue #19 still requires actual D1 parity, provider rows-read/query-time evidence,
coordinated token-rotation/rollback proof and any explicitly approved disposable
hosted target. This tool neither creates that target nor treats the existing
production deploy/readiness check as a substitute. Do not increase admission
limits from this local result. Multi-project load, skew beyond these fixtures,
concurrent hosted traffic and provider memory limits need their own measurements.

SQL reference: [SQLite window functions](https://sqlite.org/windowfunctions.html).
The queries use grouped aggregates and standard window frames, not forced
[INDEXED BY requirements](https://sqlite.org/lang_indexedby.html).
