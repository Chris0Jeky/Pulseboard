# Cloudflare deployment

Live URL: https://pulseboard-observatory.commit-atlas.workers.dev

The hosted Desk serves its UI and authenticated aggregate API from one Worker with D1.
Collection is admitted only for the projects listed in `COLLECT_PROJECTS` (Alibi since 2026-09-10,
see the activation section); publishing never activates a host integration by itself. Since 2026-09-10 a
`*/15 * * * *` cron is registered to probe the seven registered public origins (status, timing and a
content marker; never page content) and run retention; the handler is proven on the edge, but see the
receipts below for whether Cloudflare has actually invoked it. Synthetic demo data stays in the
browser. Follow ROLLOUT.md before turning collection on.

From `observatory/` (use `npm.cmd` / `npx.cmd` in Windows PowerShell):

```sh
npm ci
npm test
npm run deploy:check
npm run db:local
npm run dev:worker
```

Wrangler is pinned in the lockfile. The sharp override patches the image decoder used by its
local emulator; there is no image decoder in the deployed Worker. Reassess the override when
updating Wrangler. `.wrangler/` and `.dev.vars*` are ignored.

Deployment uses the existing authorized Cloudflare login and the D1 ID in `wrangler.jsonc`:

```sh
npx wrangler whoami
npx wrangler d1 execute pulseboard-observatory --remote --file schema.sql
npx wrangler secret put READ_TOKEN
npm run deploy
```

Use a unique random token of at least 32 characters and the secret command's secure prompt.
Never put a production token in a command argument, source file, URL or PR. The live read token
belongs in an operator-controlled secret store; the browser only keeps it in memory.

For the later schema-2 Alibi statistics producer, migrate the existing D1 database
with `npx wrangler d1 execute pulseboard-observatory --remote --file migrations/0002-alibi-statistics.sql`
before deploying a Worker that requires schema 2. The migration creates only an
aggregate table and preserves historical session event rows. Confirm `/readyz`
returns schema 2 after deployment. The new `/v1/collect-stat/alibi` route is
disabled unless `COLLECT_STAT_PROJECTS` is exactly `alibi`. The activation
candidate sets that value in production and preview, following issue #89's
browser, notice and opt-out checks. The hosted version remains unactivated
until the candidate is reviewed, merged and deployed; record its version and
the first accepted payload below before claiming live collection.
If the Worker must be rolled back to a schema-1 build, first remove
`COLLECT_STAT_PROJECTS`, stop the statistics consumer, and deploy the prior
Worker. Its old readiness check expects version 1, so run
`UPDATE schema_version SET version=1 WHERE id=1 AND version=2` against this D1
database as the final rollback step and confirm `/readyz` returns 200. Leave
the additive `statistics` table in place for forward recovery; do not drop it
or delete historical event rows. The rollback was exercised on scratch D1 and
the disposable preview Worker on 2026-09-25; production still needs its own
cutover receipt under issue #89.

## 2026-09-25: Alibi aggregate producer preview

Scratch D1 was migrated from schema 1 to 2 without dropping historical events.
Preview Worker version `c0ff3f29-c167-4424-b6c4-73685b9743dc` ran with
`COLLECT_STAT_PROJECTS=alibi`; `/readyz` returned 200/schema 2 and unauthenticated
`/v1/portfolio` returned 401. One synthetic two-count Alibi POST returned 202;
scratch D1 held exactly one aggregate row with `n=2`. An identifier-bearing
payload returned 400 and a foreign Origin returned 403. No real player event
was sent. The preview's aggregate budget-exhaustion path was not exercised;
local SQLite tests cover both sides of that transaction.

For rollback proof, the scratch schema marker was set to 1. The new Worker
reported 503 readiness as expected. The previous main Worker was deployed to
the preview as version `8388a892-4d5e-433d-9b96-c8a48fb119c6`; its readiness
returned 200/schema 1 and the new route returned 404. The two aggregate counts
and seven pre-existing raw event rows were still present in scratch D1. The
preview Worker was then deleted (`/healthz` 404), and the additive migration
restored scratch's schema marker to 2. The live production Worker and D1 were
not changed by this proof.

Production cutover later on 2026-09-25: PR #90 merged as `717a0580aa97c69c1657215ab5880a9f1520d3ee`.
The additive migration moved production D1 from schema 1 to 2 before Worker
version `6c521e83-3907-4e94-885e-c46cff517d17` was deployed. Actual HTTPS
`/healthz` and `/readyz` returned 200 (schema 2), unauthenticated
`/v1/portfolio` returned 401, and a synthetic statistics POST returned 503.
`COLLECT_STAT_PROJECTS` remains unset; the Alibi player still uses explicit
opt-in. No public default or production statistics collection was activated.

The aggregate reader and 14-UTC-date retention fix were deployed from merged
`main` on 2026-09-25 as Worker version
`76ab45a7-fe14-4156-b608-08770c0d3992`. A production Wrangler dry run
passed; live `/healthz` and `/readyz` returned 200 and unauthenticated
`/v1/statistics/alibi` returned 401. `COLLECT_STAT_PROJECTS` remained unset,
so the public default and statistics admission were still off. The aggregate
read model is separate from the legacy opt-in portfolio.

The read token was rotated on 2026-09-23 from DESKTOP-IHKOOJS (owner choice); copies saved on other machines
before that date no longer authenticate. On the deployment machine, the generated token is encrypted with current-user Windows DPAPI at
`%LOCALAPPDATA%/Pulseboard/read-token.dpapi`. To copy it for **Connect data** without printing it,
run this in PowerShell as the same Windows user, then clear the clipboard after connecting:

```powershell
$saved = Get-Content "$env:LOCALAPPDATA/Pulseboard/read-token.dpapi" | ConvertTo-SecureString
Set-Clipboard -Value ([PSCredential]::new('operator', $saved)).GetNetworkCredential().Password
# After pasting into the Desk:
Set-Clipboard -Value ''
```

## Verified 2026-09-10

- Worker version `9191b425-38a6-4174-8b97-7674188b9d20`; startup 7 ms, upload 23.34 KiB.
- D1 schema 1, remote database 65,536 bytes, zero events and zero probes after browser checks.
- 125 unit tests; 13 browser checks against both localhost and the hosted HTTPS URL, zero
  CSP violations, page errors or console errors. Initial authenticated reads use the real D1
  database; later failure scenarios are mocked by the gate.
- Wrangler dry run and local/remote schema application passed. Dependency audit: zero findings.
- Local workerd starts successfully through `src/entry.mjs` (default handler only); `/`,
  `/healthz` and `/readyz` return 200, and unauthenticated `/v1/portfolio` returns 401.
  The same API statuses were verified on the hosted Worker. Python urllib's default user agent
  was refused by Cloudflare's edge (1010); Node fetch and Chromium reach the service successfully.
- Shared harness audit and static Codex adapter checks pass. The full doctor has one environmental
  failure: its bare `codex` command resolves an unsigned PowerShell shim; `codex.cmd --version`
  succeeds (0.153.4). Runtime `/hooks` trust is not proven by these checks.
  Follow-ups: [doctor Windows shim](https://github.com/Chris0Jeky/agent-harness/issues/276) and
  [canonical estate/map reconciliation](https://github.com/Chris0Jeky/claude-config/issues/211).

## Verified 2026-09-10, later the same day: probes and the admission gate

- Running the scheduled handler on local workerd (`npx wrangler dev --test-scheduled`, `GET /__scheduled`)
  first showed every probe with status 0 after about a millisecond: Workers' fetch rejects
  `redirect: 'error'` before sending anything. With `redirect: 'manual'` all seven targets returned
  200 with their markers (80–680 ms), reached `up` on the second tick, and the seeded event, budget
  and probe-history rows older than their windows were deleted while the tick's own rows survived.
  A unit test now pins the redirect mode; `npm test` is 128 passing with the service-binding and limitations tests below.
- Preview Worker `pulseboard-observatory-preview` (versions `c16b877b…` then `f7d1fd4c…` with every
  `dailyLimit` set to 1 for that deploy only) against scratch D1 `pulseboard-observatory-scratch`
  (`75c78861-b347-4b03-8a02-7cd9a9e13bb0`), collection on, no cron. `tests/hosted-admission.mjs`
  results: mdviewer one event → 202, identical batch again → 202 with one `events` row and `used` 2;
  commitatlas two events on a fresh day → 429 with `Retry-After: 3600`, no `budget` row and no
  events; alibi one event → 202 then 429; mdviewer over budget → 429. So `INSERT … RETURNING` inside
  `batch()` behaves on hosted D1 as it does on `node:sqlite` for both the insert and the
  `ON CONFLICT` branch. The preview Worker was deleted afterwards; the scratch database stays for
  the next run.
- Deployed routes `/`, `/dashboard.mjs` carry the CSP, `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and
  `Cross-Origin-Resource-Policy: same-origin`; `/healthz` carries the JSON subset.
- Production Worker version `a400ed3d…` deployed with the cron trigger and the redirect fix. Triggering
  the handler on the edge (`wrangler dev --remote --test-scheduled`) then showed a second hosted-only
  fault: `commit-atlas` and `alibi-after-hours-preview` answered 404 `error code: 1042`, because a
  Worker cannot fetch another Worker on the same account through its public hostname. Those two
  probes now go through service bindings (`wrangler.jsonc` `services`, `probe.binding` in the
  registry); version `36240a08-5e20-4aa9-9add-02c55b149ba6` carries that, and an edge-triggered run
  returned 200 with markers for all seven targets (16–380 ms). The two bound readings prove the
  application answers, not its public edge; the canary below owns that path.
- **No unattended cron tick was observed.** Between the first cron deploy (14:43Z) and 16:00Z the
  `*/15` schedule should have fired five times; `probe_history` gained rows only from the two
  edge-triggered runs, and a `wrangler tail` connected across 15:45Z saw no invocation. A throwaway
  Worker with a `* * * * *` schedule writing to the scratch database (`pulseboard-cron-debug`,
  deleted afterwards) wrote nothing in fifteen minutes either, so the fault is not this Worker's shape.
  Cloudflare's status page explains it: incident
  [sjs8s0q2x4hw](https://www.cloudflarestatus.com/incidents/sjs8s0q2x4hw), "Workers Cron Triggers
  degraded", open since 2026-09-09 19:17Z: "Cron Triggers may not execute or may be delayed …
  updates to Cron Triggers may take some time to take effect." The cron stays registered and needs
  no change; confirming the first unattended tick once the incident resolves is tracked as an agent
  follow-up. Until then the Desk shows every probe as `unknown` or `stale` and the GitHub canary is the
  only unattended monitor.
- `.github/workflows/collector-canary.yml` checks `/healthz`, `/readyz` and the closed
  `/v1/portfolio` from GitHub's runners at :07 and :37 each hour; a red run is the only
  out-of-band signal today.

## Activation 2026-09-10: Alibi pilot

Owner decision (HUMAN_TODO q-7): "pilot Alibi, notice approved"; the account was confirmed on the
free plan (q-6) and GitHub failure notifications are on (q-8). Version
`1f8553ae…` deployed the top-level `COLLECT_ENABLED: "true"`; the review of Pulseboard#45 pointed out that
the global switch alone would admit forged events for every registered origin, so the Worker now also
requires the project id in `COLLECT_PROJECTS` (`"alibi"`): version `a40b5c40-670b-47f4-a33f-b21e2c47c662`
carries that, and a POST with the registered `Origin` of mdviewer or commitatlas answered 503 while Alibi's
answered 400 for an empty batch (route open, contract enforced).
`/v1/collect/alibi` still answers 403 without the registered `Origin` and 204 to Alibi's preflight; every
other host artifact keeps an empty endpoint, so only Alibi can send once its PR (Chris0Jeky/Alibi#83)
ships with the endpoint and the collector origin in its CSP.
The player-facing consent text is the adapter's own: "Usage sharing" / "Optional: share a small set
of action counts with pulseboard-observatory.commit-atlas.workers.dev. No document text, filenames,
form values or browsing history is sent. Raw events expire after 14 days. Your choice lasts 90 days on
this browser." Receipts, 2026-09-10 18:00–18:11Z, Alibi 0.11.1 (Chris0Jeky/Alibi#83, Worker version `38a1ca89…`):

- The hosted page carries the collector origin in its CSP `connect-src`; the adapter ships as a
  separate online-only asset (`assets/observatory.cedd32490510.js`, byte-identical to the lock) loaded
  after the page's `load` event, so Alibi's initial-JavaScript and offline-shell budgets are untouched.
- Real browser: ticking **Usage sharing** produced the first admitted event, `page.view` / `home` /
  `unattributed`, at 18:03:56Z; `budget.used` 1. The first POST took 5.4 s on a cold path and hit the
  adapter's 5 s abort, so the client counted a failure while the collector had admitted the row
  (#32 item 7). A reload sent a second `page.view` in about 1 s: collector total 2, two distinct
  page sessions, `used` 2. Unticking stored `allow: false`; a further reload made no collect request
  and the total stayed at 2. Every other registered project still answers 503.
- The Desk therefore shows Alibi with two opted-in page sessions and every probe still `unknown`
  or `stale` until Cloudflare's cron incident clears (#43).

Check `/healthz` and `/readyz`, confirm unauthenticated `/v1/portfolio` returns 401, then use
the Desk's Connect control with the read token. Run `tests/desk-browser.py --origin <url>` with
`READ_TOKEN` in the process environment to prove HTTPS assets, CSP and interactions. That gate
also uses mocked failure scenarios; it does not prove live collection admission, which is what
the preview run above did. Collection is on for the projects in `COLLECT_PROJECTS` only (q-7 decided Alibi).

This deployment uses only Workers and D1, with no paid-plan upgrade. Free-plan limits and
account-wide usage still apply; consult the official [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) before activation.
The OAuth token used here cannot read account subscriptions (403), so account plan identity
and spending notifications require the owner's dashboard check.

## GitHub evidence token (q-9, decided 2026-09-22)

The owner chose Alibi as the first mapped project and approved a token. The mapping ships in
`src/github-map.mjs` (revision 2: repository `1360756863`, workflow `352677495` = `.github/workflows/check.yml`
on `main`, the latest 5 releases, no deployment environment). Creating the token and setting the secret are
owner actions; no agent holds either.

1. Create a fine-grained personal access token: resource owner `Chris0Jeky`, repository access "Only select
   repositories" with `Alibi` alone, permissions **Actions: read** and **Contents: read** (Metadata: read is
   added automatically), and a short expiry (90 days or less). Nothing else.
2. Local Desk: export `GITHUB_EVIDENCE_TOKEN` in the foreground shell before `node src/local.mjs`. The banner
   says whether the connector was built; the token is never printed.
3. Hosted Desk: the Worker deployed on 2026-09-10 predates `/v1/github-evidence`, so deploy current `main`
   first (`npx wrangler deploy --dry-run`, then `npx wrangler deploy`), then run
   `npx wrangler secret put GITHUB_EVIDENCE_TOKEN` and paste the token at the prompt (never on the command
   line). Rotate with the same command; remove with `npx wrangler secret delete GITHUB_EVIDENCE_TOKEN`.
4. Check: open the Alibi dossier, press **Read workflow evidence**. Expect the `check.yml` row as `passing`,
   `failing` or `pending` with a run id and head SHA, and releases as `observed`. If every item reads
   `unavailable/network` on the hosted Worker only, the edge rejected the fetch option set: record it in #20
   and remove the secret; it can never read as a false pass.

### First live reading, 2026-09-23

- Worker version `1d071326-6c6d-4594-83a8-c5ea2d5865bb` deployed from `main` at `93b73ed` (previous
  `a40b5c40…`, per `wrangler deployments list`). Schema and bindings unchanged; `/healthz` and `/readyz` 200,
  `/v1/portfolio` and `/v1/github-evidence` 401 without the read token.
- `GITHUB_EVIDENCE_TOKEN` set by the owner (fine-grained, `Chris0Jeky/Alibi` only, Actions and Contents read).
- Authenticated `GET /v1/github-evidence?project=alibi`: `configuration: ready`, repository `observed`;
  `check.yml` on `main` `passing` (run 35794927343, attempt 1, head `9a35ff1`); releases `observed`
  (v0.11.4, v0.11.3, v0.11.2, v0.11.1, v0.11.0). No item read `unavailable/network`, so the edge accepts
  the fetch option set.
- The same portfolio read showed Alibi admitted with its probe `up` but zero events over 7 days: live Alibi
  serves 0.11.5 and its served artifact (`assets/observatory.742e8aa3bb5e.js`) lists `0.11.5`, so the client sent
  `release: "0.11.5"`, which the closed release allowlist did not list: every consented event from the current
  release was rejected. #71 added `0.11.5`; Worker version `d76f3d16-6a34-4b8c-bca1-ba47009b5701` deployed it from `main` at
  `60e7880` the same day (`/healthz`, `/readyz` 200; `/v1/portfolio` 401 unauthenticated). A consented
  production event from 0.11.5 has not been observed yet.

### `puzzle.failed` admitted, 2026-09-23 (q-11)

- #63 merged as `f53420b`: Alibi registers `puzzle.failed` and the named operation `puzzle.solve` v1.
- Admission gate on a preview Worker (`pulseboard-observatory-preview`, scratch D1, version `3554a37b…`): one Alibi
  batch with the registered `Origin`, release `0.11.5`, route `puzzle` and `puzzle.started`, `hint.requested`,
  `puzzle.failed`, `puzzle.started`, `puzzle.completed` → 202; an unregistered event name → 400 `contract`; an
  unregistered release → 400 `contract`. The preview was deleted afterwards (`/healthz` 404).
- Production Worker version `eda4e81d-70f2-4731-95ce-f8be1362315f` deployed from `f53420b`; bindings unchanged
  (`COLLECT_ENABLED` `"true"`, `COLLECT_PROJECTS` `"alibi"`). `/healthz`, `/readyz` 200; `/v1/portfolio` 401
  unauthenticated and 200 with the read token, where Alibi carries `puzzle.solve` v1 with zero attempts, so the
  operation query runs on the production database. Rollback goes to `d76f3d16…`.
- Alibi's host artifact was regenerated with `puzzle.failed` and journey hooks (Chris0Jeky/Alibi#183, merged
  `a3b48da`) and deployed to `alibi-after-hours-preview` as Worker version `3d83bc77…`: the served
  `assets/observatory.1e4e10824d07.js` lists `puzzle.failed` and `0.11.5`, and 291/291 public files match the
  build. No consented production journey event has been observed yet.
