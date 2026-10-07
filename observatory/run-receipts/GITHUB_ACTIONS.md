# Offline GitHub Actions receipts (#23)

This adapter converts explicitly supplied workflow-run-attempt and job-page JSON
into the existing private receipt contract. It makes no API request, reads no
credential, activates no account integration, changes no server mapping, and
never imports or publishes anything merely because it was previewed. The two
`github-actions-*.sample.json` files are synthetic, not real usage history.

## Try the complete local path

From `observatory/`:

```sh
# Read-only preview, with private run/job identifiers and provider text removed.
node run-receipts/github-actions-file.mjs \
  run-receipts/examples/github-actions-export.sample.json \
  run-receipts/examples/github-actions-map.sample.json

# Use an existing trusted directory outside source control for explicit publication.
node run-receipts/github-actions-file.mjs write \
  run-receipts/examples/github-actions-export.sample.json \
  run-receipts/examples/github-actions-map.sample.json \
  /YOUR/PRIVATE/DIRECTORY/reviewed-receipts.json

# Review the resulting file before the separate, existing import command.
node run-receipts/file-adapter.mjs preview /YOUR/PRIVATE/DIRECTORY/reviewed-receipts.json
node run-receipts/file-adapter.mjs import /YOUR/PRIVATE/DIRECTORY/reviewed-receipts.json \
  /YOUR/PRIVATE/DIRECTORY/private.sqlite
```

Replace the explicit private directory with your own platform's path. Preview
creates no files or database. `write` validates the full conversion first, writes
a temporary file with mode 0600 requested, flushes it, then publishes through a
same-filesystem hard link that cannot overwrite an existing path or symlink.
The parent directory must exist and be trusted. Unsupported link/filesystem
capabilities fail rather than falling back to an overwrite. Temporary files are
cleaned during normal error handling; crash recovery and arbitrary hostile
filesystem changes are not guaranteed. Unix permissions remain subject to the
host filesystem and Windows access controls are not certified by Linux tests.
CLI errors never echo raw JSON excerpts, paths, titles, actors or exception text.

## Assemble an export

The separate mapping is exactly:

```json
{"project":"alibi","repositoryId":1360756863,"workflowId":352677495}
```

Those ids match the already-reviewed Alibi mapping. Another mapping must be an
explicitly reviewed choice, not fuzzy matching from a workflow display name.
This local file does not edit `src/github-map.mjs` or grant any network permission.

The closed export wrapper is:

```text
{
  schema: "pulseboard.github-actions-export/1",
  generatedAt: <UTC export time>,
  coverage: { start: <selected UTC start>, end: <selected UTC end> },
  attempts: [ { run: <attempt-specific run object>, jobPages: [<job page>, ...] }, ... ]
}
```

Supply the objects from GitHub's **Get a workflow run attempt** and **List jobs
for a workflow run attempt** endpoints, using the same run and attempt number.
Preserve all job pages and each page's `total_count`. These endpoints are documented
in [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt)
and [workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt).
The run-level jobs endpoint depends on its `latest` or `all` filter. Require
attempt-specific exports here; do not substitute it and relabel mismatched rows. A missing `run_attempt` is refused, not guessed.
No log archive, billing response, step output or provider token is needed.

Run objects must contain numeric `id`, `workflow_id`, `repository.id`,
`run_attempt`, a 40-character lowercase `head_sha`, completed `status` and supported
`conclusion`. Jobs need numeric `id`, matching `run_id`, `run_attempt` and
`head_sha`, completed `status`, supported `conclusion`, `started_at` and
`completed_at`. Provider names, URLs, actors, steps and other extra provider fields
are discarded. Unknown wrapper or mapping fields are rejected.

The 256 KiB input cap is checked before parsing. At most 256 attempt records,
10 pages of at most 100 jobs per attempt, and 4,096 jobs overall are supported.
All page totals for an attempt must agree and equal its unique supplied job count.
The same job id cannot appear twice, including across attempts. Run, repository,
workflow, attempt and head mismatches reject the entire file. Pending records,
missing timestamps, empty job lists, unsupported conclusions and inconsistent
page sets also reject it; nothing is silently discarded or reported as zero use.
Supported conclusions are `success`, `failure`, `cancelled`, `timed_out` and
`skipped`. A skipped job lacking interval evidence is therefore refused too.

Times must be real UTC dates, with seconds or exactly three fractional digits.
They normalize to canonical milliseconds. Existing receipt validation checks the
selected coverage, 90-day maximum window, seven-day maximum receipt interval and
export time. Retry chains require every previous attempt in the same file; an
export containing only attempt 2 does not invent attempt 1. Canonical ordering
makes job-page and attempt order irrelevant to receipt identity.

## What is measured, and what is deliberately not inferred

`runner_seconds` is the sum of the supplied jobs' `completed_at - started_at`
intervals, including parallel jobs. It is **not billable minutes, CPU time, an
invoice or a price**. Fractional milliseconds are summed before conversion and
must represent an integer number of seconds; they are not silently rounded.
For example, overlapping 60-second and 30-second jobs yield 90 runner-seconds,
not 60. No job-name, runner-name, OS multiplier or plan-price guess is involved.

Receipt `startedAt` and `endedAt` bound the earliest observed job start and latest
observed job completion. This is an **observed job envelope**, not queue time or
exact workflow completion. `updated_at` is not used as a completion timestamp.
These qualifications survive import into the private summary and question card,
not just the CLI preview. Source ids carry the `gh-jobs-v1` measurement revision.

Every converted receipt has `cost: null` and `outcome.state: "unverified"`, even
when its workflow succeeded. Every export has incomplete, manual, partial-history
coverage. Matching job-page totals do not certify that every workflow in the
selected time window was exported. Cost per verified accepted outcome therefore
abstains. File identity checks, numeric matching and an API-shaped JSON document
do not authenticate the export or turn it into a live CI-status report.

## Evidence and remaining gates

The synthetic tests cover parallel intervals, outcomes, retries, canonical order,
page completeness, duplicate and mismatched identities, times, bounds, private
preview, non-overwriting publication, temporary-write failure and real SQLite
import/deduplication/question-card integration. A reviewed API projection from one
already-mapped Alibi workflow was also converted locally: one job yielded 1,532
runner-seconds, one private receipt, one duplicate on reimport, no cost and no
verified accepted outcome. Its selected fields and private database are not
committed to this public repository. This qualifies one source shape, not complete
provider history, billing, general workflow coverage or production collection.

Issue #23 remains open for broader provider coverage and independent outcome
verification. Hosted storage, account scopes and automatic synchronization remain
separate decisions. No metadata from this path enters the public portfolio or
pulse exporter, and no converter file is added to the static Desk asset map.
