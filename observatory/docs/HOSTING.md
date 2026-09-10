# Cloudflare deployment

Live URL: https://pulseboard-observatory.commit-atlas.workers.dev

The first hosted Desk serves its UI and authenticated aggregate API from one Worker with D1.
Collection is disabled and the cron list is empty: publishing does not activate host integrations
or external probes. Synthetic demo data stays in the browser. Follow ROLLOUT.md before activation.

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

Check `/healthz` and `/readyz`, confirm unauthenticated `/v1/portfolio` returns 401, then use
the Desk's Connect control with the read token. Run `tests/desk-browser.py --origin <url>` with
`READ_TOKEN` in the process environment to prove HTTPS assets, CSP and interactions. That gate
also uses mocked failure scenarios; it does not prove live collection admission. The scratch-D1
202/deduplication/429 gate in ROLLOUT.md remains required before collection is enabled.

This deployment uses only Workers and D1, with no paid-plan upgrade. Free-plan limits and
account-wide usage still apply; consult the official [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) before activation.
The OAuth token used here cannot read account subscriptions (403), so account plan identity
and spending notifications require the owner's dashboard check.
