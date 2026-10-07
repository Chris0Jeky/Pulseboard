# Inspecting named-operation evidence

The Desk requests `pulseboard.portfolio/3` through its existing authenticated
portfolio read. The server default remains v2, so existing callers do not receive
new fields unless they request them. An older collector returning v2 is accepted,
but its missing unmatched-outcome counts are **unavailable**, never assumed zero.
This completes the inspection slice after #211. The measurement contract and
sequence/window rules are in [NAMED_OPERATIONS.md](NAMED_OPERATIONS.md).

## Inspect and review

Open a project from Overview. **Named operation evidence** shows each registered
operation's starts, paired completions and failures, open starts, retry candidates,
and unmatched completion/failure events. Expand **By release** for the bounded
release breakdown. The combined `other` bucket is labelled as combined, not as a
real version. The table scrolls horizontally without widening a phone viewport.

An unmatched outcome did not consume an in-window start under the strict pairing
rules. It does not add a failed attempt or change the completion denominator.
Lost starts, extra terminals, sequence ties, changed routes or receipt-window
boundaries can explain it; the count does not identify which explanation applies.
An open start is likewise not proof of failure, and a retry candidate need not be
the same puzzle. This inspection reads legacy session `events`, not newer Product
journeys or aggregate-only counts. It does not certify current Alibi hook order.

Use **Review unmatched outcomes** or **Review unavailable detail** to open a
review note with the evidence and a suggested next check. The same note appears
in Alerts. **Inspect operation evidence** returns from the note to its source
project drawer. Both directions retain the snapshot being reviewed, even when a
poll updates the rest of the Desk. Reopen the project to inspect a newer reading.
Replacement drawer headings receive focus; no new modal or background read is
introduced.

The notes use the separate `operation-evidence/1` rule version. Existing
`desk-rules/1` thresholds and outcomes are unchanged. The new note is not a failure
diagnosis, an executable instruction or a productivity measure. Observed v3 zero
unmatched counts do not emit an unmatched-outcome note. The synthetic Quiet
scenario now supplies a registered zero-attempt operation, so its existing
no-evidence rule contributes one informational note rather than inventing activity.

## Source, freshness and export

The drawer names the source schema, snapshot time, reporting window, session-event
admission and synthetic or last-known state. Failed refreshes, expired snapshots
and future-dated readings are qualified as last-known. A later successful poll
does not rewrite the pinned source. Preparing a handoff recalculates the operation
note's freshness against its pinned snapshot; it never substitutes the new poll's
counts. Missingness in a v2 reading remains null in the review evidence.

The existing **Prepare a task handoff** action still emits v1. **Prepare identified
handoff (v2)** adds stable subject identity for compatible receivers; changed counts
resurface the local review key without becoming a different subject. Preview does
not download or import. Download requires the existing review checkbox and writes
exactly the previewed bytes. The receiver still previews by default and grants no
execution permissions. Synthetic labels survive this route. Public pulse export
remains a separate, probe-only projection and contains no operation evidence.

## Verification and transfer budget

From `observatory/`:

```sh
npm test
node --test tests/desk-operations.test.mjs tests/operation-reading.test.mjs
python tests/operation-browser.py --origin http://127.0.0.1:8788
```

The browser command expects the real local server and its test read token, as in
the existing Desk browser workflow. It checks HTTP asset serving, CSP, native v2
hashing and the authenticated v2/v3 API. All displayed nonempty readings are
explicitly synthetic fixtures generated through the actual SQLite read model;
the local collector remains disabled. No product origin or account is contacted.

Where local browser networking is unavailable, `--offline` reuses the repository's
inlined-asset harness. It checks the same drawer round-trip, changed-poll pinning,
malformed-refresh retention, v2 absence, inert markup, 390-pixel layout and exact
reviewed v1 download/receiver preview. It does **not** prove HTTP, CSP or native
WebCrypto. Those remain mandatory real-server CI gates before merge.

This continuation reproduced all ten draft #212 tests failing before implementation.
The six reading-model tests include five expected failures before the module was
added. The full suite then passed 787 tests with no skips. An independent browser
mutation removed the explicit source pin at the project-to-signal link: the
round-trip test failed after a new poll, then passed with the pin restored. Earlier
browser fixture URL expectations were updated to the explicitly negotiated URL;
no serving assertion was removed to obtain a pass.

Measured assets total 251,756 raw bytes and 82,550 independently gzipped bytes
(245.9 and 80.7 KiB, rounded up to one decimal). The concrete inspection/review
interaction raises the checked ceiling from 240/80 to **256/84 KiB**. It adds no
runtime dependency, data request, polling loop, event admission or storage budget.

## Remaining acceptance work

Issue #73 stays open for current Alibi host hook-order qualification. The legacy
contract cannot be inferred from a passing newer Product-journey test. Hosted D1
capacity/rollback work in #19, broader private provider/outcome evidence in #23,
and previously tracked historical cleanup and delivery investigations are not
closed by this UI change. No `HUMAN_TODO` decision, credential, consent setting,
collection allowlist, retention period, hosted resource or global mapping changes.
GitHub PR #212 holds the exact final-head CI and merge evidence; this document is
not a live CI-status report. Review in this continuation was separate self-review,
not an independent subagent review.
