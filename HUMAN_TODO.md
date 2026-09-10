# Owner decisions — Pulseboard

Agents surface this file in every summary and tick an item only when its completion is directly
verified. Items that need the owner's judgement stay open until the owner answers here or in chat.

- [x] q-1 — **Ratify the tier. DONE 2026-09-10:** owner replied "T2 is good"; tier.json notes now start `Ratified 2026-09-10`. Original item: `.agent-harness/tier.json` declares T2 (daily driver; push free,
  merge free within the global gate). Proposed by the 2026-09-10 harness session on this evidence:
  public repository, no deployment, no accounts or participant data, collection disabled by default,
  durable multi-session use, and a live PR stack. Reply "T2 stands" or name another tier; the agent
  then prepends `Ratified <date>.` to the `notes` field so tier.json alone shows proposed vs ratified.
- [x] q-2 — **Hosted activation gate. AUTHORISED 2026-09-10:** owner replied "go ahead". Execution is issue #19 after the stack lands, and it needs Cloudflare access the executing box does not have (q-4). Original item: Creating any Cloudflare Worker or D1 resource, setting a
  production read token, or turning collection on for any host project requires your explicit
  go-ahead, per `observatory/docs/ROLLOUT.md` and issue #19. Nothing in PRs #15–#17 or issues
  #18–#24 authorises it on its own.
- [x] q-3 — **Confirm the Desk pivot for the merge lane. AUTHORISED 2026-09-10:** owner replied "ship the stack", adding that #15–#17 were prototyping and must be deeply checked and tested first; agents review, fix and merge oldest-first on that basis. Original item: PRs #15 → #16 → #17 replace the root
  README thesis and make `observatory/` the primary product. The pivot is a product decision, so
  T2's `merge: free` does not cover it: no agent merges any of the three until you reply
  "ship the stack" (or name what must change first). Once authorised, the agent review-and-ships
  them oldest first, retargeting each child after its base lands.

- [x] q-4 — **Cloudflare access verified 2026-09-10.** Wrangler 4.130.0 found an existing OAuth login on this machine with Workers and D1 write scopes. The Worker and D1 database are deployed; see `observatory/docs/HOSTING.md`. Scheduled probes were enabled later the same day at the owner's request ("start monitoring some of the published sites"); collection stays disabled.
- [ ] q-5 — **Trust the reviewed Codex adapter.** Start a fresh Codex session in this checkout, open `/hooks`, and confirm the `.codex/hooks.json` handler is enabled and trusted. Static checks pass but cannot certify this session-only state.
- [ ] q-6 — **Account plan and spending notifications.** Confirm the account remains on the intended free plan in Cloudflare's dashboard and select acceptable notifications. The existing OAuth token returns 403 for subscription reads. This deployment makes no paid-plan change. With probes on, the Worker runs 96 cron invocations a day, each with seven outbound fetches and roughly fourteen D1 writes: far inside the free allowances, but the dashboard is the only place that shows the account-wide picture.
- [ ] q-7 — **Choose the first collection pilot and review its privacy notice.** The collector admits events correctly on hosted D1 (gate passed 2026-09-10, `observatory/docs/HOSTING.md`) and the seven host PRs carry inert, regenerated artifacts (#31). Turning `COLLECT_ENABLED` to `"true"` and giving one host artifact its endpoint is a product and privacy decision, not cleanup: `observatory/docs/ROLLOUT.md` suggests CommitAtlas first (it needs only its notice and CSP review), while MDviewer and Alibi need an explicit notice/release review and Developer Lens needs tests that its private builds never load the integration. Reply with the pilot's name and "notice approved" once you have read that host's notice text; the agent then flips the variable, regenerates that one artifact with `https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect/<id>`, moves the host PR out of draft and inspects the first accepted payload before anything else is activated.
- [ ] q-8 — **Confirm GitHub failure notifications reach you.** `.github/workflows/collector-canary.yml` checks the hosted collector twice an hour from GitHub's runners and goes red on a non-200 `/healthz` or `/readyz` or an open `/v1/portfolio`. GitHub e-mails workflow failures only if "Actions" notifications are on for your account (Settings → Notifications → Actions, "Failed workflows only" is enough). Nothing else pages: a probe reading `down` shows in the Desk and nowhere else.

The encrypted operator read token is stored at `%LOCALAPPDATA%/Pulseboard/read-token.dpapi` for this Windows user. `observatory/docs/HOSTING.md` explains how to copy it without printing it. The public demo needs no token.

Tracked debt that needs no owner input: #43 (the first unattended probe cron tick, pending behind Cloudflare
incident sjs8s0q2x4hw, "Workers Cron Triggers degraded", open since 2026-09-09; until it lands every probe
reads `unknown` or `stale` in the Desk), #13 (legacy quality gates), #14 (setuptools floor), #19 (the
remaining query-budget and rollback evidence), #32/#33 (low findings) and the post-merge issues on the
Desk delivery order (#18, #20–#24, #35).
