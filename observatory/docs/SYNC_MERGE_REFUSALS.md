# Site sync: a refusal is not permission to replay

The existing three-attempt sync loop may rebuild only when fresh GitHub metadata
explicitly says `BEHIND` for the exact head whose checks passed. Error messages
such as "not up to date" cannot override `BLOCKED`, unknown metadata, a changed
head, or the attempt ceiling. No check, review, branch protection, file equality,
bot-author guard, or force-with-lease protection is bypassed.

`adapters/sync-merge-refusal.mjs` is a read-only helper run from the Pulseboard
checkout, never from the target site's code. It uses argument-array `gh` calls,
15-second timeouts and a 256 KiB response cap. Its zero exit status permits only
the existing bounded replay path; it never merges, pushes or resolves a thread.

The Actions summary records the expected and observed head, explicit merge state,
review decision, attempt and unresolved review-thread links with original reviewed
revisions. Only the first 50 threads are read. Truncation or unavailable diagnostics
are stated explicitly; they are not evidence of clean review. Free-text comments,
PR titles, tokens and unexpected URLs are not copied into this summary. Thread
diagnostics cannot upgrade a refused metadata decision.

The test executes the real workflow merge step using inert command fakes. All git
commands stop at a marker before repository operations; sleep is stubbed only in
the test. BLOCKED plus misleading prose and a post-refusal head change reproduced
failures before the repair. An explicit BEHIND control still reaches the existing
replay boundary. Unit tests cover metadata failure, attempt bounds, safe thread
links and missing/truncated diagnostics. No test creates a real cross-repository
sync PR or claims an actual production base-movement event was exercised.

Run from `observatory/`: `node --test tests/sync-merge-refusal.test.mjs`.
The native workflow execution tests require the same Bash environment used by the
Ubuntu sync job. The helper itself is dependency-free Node 22.
