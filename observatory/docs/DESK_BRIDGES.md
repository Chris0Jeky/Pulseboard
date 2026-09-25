# Ecosystem bridges

## Status matters

| Direction | Implemented here | Still needs a producer / consumer |
| --- | --- | --- |
| Observatory -> Desk | Authenticated aggregate API, legacy opt-in client and separate Alibi statistics client | Other projects remain opt-in; no further statistics consumer is admitted |
| CommitAtlas -> Desk | Reader for existing native v2 `projects.json` | Automatic refresh and explicit repo-to-project mapping |
| Developer Lens -> Desk | Strict reader for `pulseboard.lens-projection/1` | Native Lens exporter for this new contract |
| GitHub -> Desk | Server-side connector for a reviewed numeric-id mapping, `pulseboard.github-evidence/1`, release notebook | An owner-approved mapping (q-9: Alibi) and a server-side token |
| Desk -> CommitAtlas / status card | Selected, expiring `pulseboard.public-pulse/1` export | Upstream renderer / consumer |
| Desk -> Taskdeck / agent | Reviewed `pulseboard.handoff/1` JSON | Native task importer with preview, deduplication and approval |
| Legacy feeds / OTel -> Desk | Architecture seam only | Bounded adapter implementation |

These are not automatic account connections. Selecting a file does not follow its
URLs, contact GitHub, call an LLM or upload it. Imports have a 256 KiB limit and
bounded object/array fields. Only projected fields survive in tab memory. Imports
are never mixed into telemetry totals, operational rules or public pulse exports.

## Alibi collection contract

Alibi's `package.json` version is sent as the release label on opted-in events.
The collector and the copied browser adapter share one closed release list in
`observatory/src/alibi-releases.mjs`; `projects.mjs` feeds that list to both
collector validation and artifact generation. The generated Alibi host checker
compares the app version with the installed artifact and prints the version,
registered releases and artifact hash, so release drift fails during host CI.

From a Pulseboard checkout, synchronize a candidate Alibi release with:

```sh
cd observatory
npm run sync:alibi
npm run check:alibi
```

When there is exactly one Alibi checkout beside Pulseboard, the commands find it
automatically. Set `ALIBI_REPO` to choose a checkout elsewhere; a positional path
overrides that setting. If discovery finds more than one candidate, it stops and
asks for an explicit choice. Both commands also accept `--json` for machine-readable
success and failure receipts.

The sync command requires `alibi-puzzle-club`, a stable package version and one
matching `content/releases.json` record with the matching `v<version>` tag. It
adds only that version to the closed collector list and regenerates the
Pulseboard-owned `observatory/browser.js`, lock and shared host checker in the
Alibi checkout. The existing approved collector endpoint is preserved. Locally
edited or unowned host files, a mismatched lock, or a different endpoint stop the
sync for manual reconciliation. The JSON receipt reports the resolved checkout
source, package version, complete accepted list, target, byte count, SHA-256 and
exact files changed in both repositories. `check:alibi` is read-only and reports
`in-sync` only when the candidate host artifact matches the Pulseboard source and
lock.

The **Alibi connection watch** workflow checks public Alibi `main` once a day and
can be run on demand. It writes a release and adapter receipt to the Actions
summary; drift fails the run with the specific reconciliation command. The watch
does not write either repository, deploy the collector or change collection
settings.

Merge the Pulseboard contract before the Alibi release that first sends the new
label. Do not deploy or publish as part of synchronization; hosted collection
and Alibi publication remain separate release gates.

## CommitAtlas: consume the contract that already exists

The reader is grounded in `packages/static/src/projects-catalog.ts` and the core
CI/lifecycle schema at CommitAtlas commit
`9d3307b10863843c0276a5145e9410fc2a4615b7`. Version 2 is mandatory. In particular,
`openIssuesAndPullRequests` must not be relabelled as only issues.

The input declares `generator: CommitAtlas`, `source: github-public-rest`, an owner,
UTC generation time and projects. The adapter retains canonical repository identity,
label, lifecycle, CI state and named workflow, optional release tag, stars, forks
and the combined open count. Descriptions, actions, download links, arbitrary
extra fields and URLs are discarded. Duplicate or owner-mismatched repositories
fail closed. No code branches on stars to infer quality or developer productivity.

CI and availability remain different claims. Catalogue time is not exact workflow
observation time. An absent release is **not supplied**, not proof of no release.
Every imported catalogue remains labelled **UNVERIFIED FILE**. An old or future
artifact gets a separate freshness warning. Matching to an operational project is
an explicit future configuration task, not a guessed association.

## Developer Lens: proposed producer contract, working reader

`examples/lens-projection.synthetic.json` is an invented, executable example.
It is not a native Developer Lens export or a real conclusion about this user.
The reader accepts exactly these top-level keys:

```json
{
  "schema": "pulseboard.lens-projection/1",
  "mode": "synthetic",
  "reviewed": true,
  "generatedAt": "2026-09-10T12:00:00Z",
  "window": {"start": "2026-09-01T00:00:00Z", "end": "2026-09-10T12:00:00Z"},
  "coverage": {"eligible": 100, "observed": 70, "censored": 20},
  "findings": [{
    "id": "review.interval", "kind": "hypothesis", "title": "Review delay may need a closer look",
    "detail": "The invented cohort has longer review intervals.", "n": 50,
    "limitations": ["Synthetic observations. No real repository inference."]
  }]
}
```

Real reviewed exports use `mode: redacted`. Findings keep their kind: observation,
pattern, hypothesis or abstention. The reader does not promote hypotheses to facts.
Coverage keeps observed, censored and missing separate; observed + censored cannot
exceed eligible. Each finding needs a bounded sample size and limitations.

Additional raw fields are rejected. Obvious URL, local-path and credential shapes
in finding text are rejected too, but this is not an anonymity guarantee. A file's
`reviewed: true` is an assertion, not a signature. The UI requires a second, exact
projection preview before keeping it. Do not feed private Lens event stores,
repository names, PR titles or source paths into this schema. The upstream producer
must use Lens's existing reviewed-redaction path, not serialize its live dashboard.

## Public pulse: small enough to audit

Choose specific externally probed project IDs, preview the exact file, acknowledge
its sharing boundary, then download. Empty, duplicate, unknown and local-only
selections are rejected. Stale desk reads must be refreshed before export.

The explicit allowlist is: schema, source mode, generation/expiry times, observed
window, selected project IDs, each probe's state/check time, sampled successful
checks/total checks, and fixed limitations. It has **no usage counts, session IDs,
releases, budgets, imports, tasks, private findings, tokens or URLs**.

A future consumer must validate the schema, enforce expiry, preserve demo markings,
render unknown/stale states honestly and refuse to call sampled checks uptime.
The file is unsigned. It must not become a public availability guarantee or an
unsupervised source of incident paging.

## Review handoffs

`pulseboard.handoff/1` records one rule observation, its evidence, proposed next
check, source mode, window, rule version and whether the desk's last refresh had
failed (`stale`, always present). It is deliberately tool-neutral.
Taskdeck could create a proposal card with an evidence attachment; an in-repo
agent could first verify that the observation still holds. Neither destination
should treat the packet as approval to edit, merge, deploy or contact users.
