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

- [x] q-4 ? **Cloudflare access verified 2026-09-10.** Wrangler 4.130.0 found an existing OAuth login on this machine with Workers and D1 write scopes. The Worker and D1 database are deployed; see `observatory/docs/HOSTING.md`. Collection and scheduled probes remain disabled.
- [ ] q-5 ? **Trust the reviewed Codex adapter.** Start a fresh Codex session in this checkout, open `/hooks`, and confirm the `.codex/hooks.json` handler is enabled and trusted. Static checks pass but cannot certify this session-only state.
- [ ] q-6 ? **Account plan and spending notifications.** Confirm the account remains on the intended free plan in Cloudflare's dashboard and select acceptable notifications. The existing OAuth token returns 403 for subscription reads. This deployment makes no paid-plan change.

The encrypted operator read token is stored at `%LOCALAPPDATA%/Pulseboard/read-token.dpapi` for this Windows user. `observatory/docs/HOSTING.md` explains how to copy it without printing it. The public demo needs no token.


Tracked debt that needs no owner input: #13 (legacy quality gates), #14 (setuptools floor), and the
issues filed 2026-09-10 for Node 24 test failures, the tracked `.vite` cache, and the post-merge
`AGENTS.md` reconciliation.
