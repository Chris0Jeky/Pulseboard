# Owner decisions — Pulseboard

Agents surface this file in every summary and tick an item only when its completion is directly
verified. Items that need the owner's judgement stay open until the owner answers here or in chat.

- [ ] q-1 — **Ratify the tier.** `.agent-harness/tier.json` declares T2 (daily driver; push free,
  merge free within the global gate). Proposed by the 2026-09-10 harness session on this evidence:
  public repository, no deployment, no accounts or participant data, collection disabled by default,
  durable multi-session use, and a live PR stack. Reply "T2 stands" or name another tier; the agent
  then prepends `Ratified <date>.` to the `notes` field so tier.json alone shows proposed vs ratified.
- [ ] q-2 — **Hosted activation gate.** Creating any Cloudflare Worker or D1 resource, setting a
  production read token, or turning collection on for any host project requires your explicit
  go-ahead, per `observatory/docs/ROLLOUT.md` and issue #19. Nothing in PRs #15–#17 or issues
  #18–#24 authorises it on its own.
- [ ] q-3 — **Confirm the Desk pivot for the merge lane.** PRs #15 → #16 → #17 replace the root
  README thesis and make `observatory/` the primary product. The pivot is a product decision, so
  T2's `merge: free` does not cover it: no agent merges any of the three until you reply
  "ship the stack" (or name what must change first). Once authorised, the agent review-and-ships
  them oldest first, retargeting each child after its base lands.

Tracked debt that needs no owner input: #13 (legacy quality gates), #14 (setuptools floor), and the
issues filed 2026-09-10 for Node 24 test failures, the tracked `.vite` cache, and the post-merge
`AGENTS.md` reconciliation.
