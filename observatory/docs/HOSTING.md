# Cloudflare deployment

Live URL: https://pulseboard-observatory.commit-atlas.workers.dev

The hosted Desk serves its UI and authenticated aggregate API from one Worker with D1.
Collection is disabled: publishing does not activate host integrations. Since 2026-09-10 a
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

On the deployment machine, the generated token is encrypted with current-user Windows DPAPI at
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
`1f8553ae-dc55-4227-8b8a-8307fa188d45` deploys the top-level `COLLECT_ENABLED: "true"`. With
collection on, `/v1/collect/<id>` still answers 403 without the registered `Origin` and 204 to Alibi's
preflight; every other project keeps an empty endpoint in its host artifact, so only Alibi can send
once its PR (Chris0Jeky/Alibi#83) ships with the endpoint and the collector origin in its CSP.
The player-facing consent text is the adapter's own: "Usage sharing" / "Optional: share a small set
of action counts with pulseboard-observatory.commit-atlas.workers.dev. No document text, filenames,
form values or browsing history is sent. Raw events expire after 14 days. Your choice lasts 90 days on
this browser." Receipts for the first consented payload and the withdrawal check follow below once
the Alibi deployment is live.

Check `/healthz` and `/readyz`, confirm unauthenticated `/v1/portfolio` returns 401, then use
the Desk's Connect control with the read token. Run `tests/desk-browser.py --origin <url>` with
`READ_TOKEN` in the process environment to prove HTTPS assets, CSP and interactions. That gate
also uses mocked failure scenarios; it does not prove live collection admission, which is what
the preview run above did. Turning collection on still needs the pilot decision (HUMAN_TODO q-7).

This deployment uses only Workers and D1, with no paid-plan upgrade. Free-plan limits and
account-wide usage still apply; consult the official [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) before activation.
The OAuth token used here cannot read account subscriptions (403), so account plan identity
and spending notifications require the owner's dashboard check.
