# Handoff consumer conformance

`examples/handoff-fixtures.synthetic.json` contains 12 deterministic exports from
`makeDemo`, `buildSignals`, `makeLegacyHandoff` and the default `makeHandoff`. Both v1 and
v2 cover the 1/7/14-day windows, a project-specific observation, and a stale
portfolio-wide observation whose project is null. Every fixture is synthetic.

Each case keeps the exact UTF-8 input as `text`, its SHA-256, the full subject
SHA-256 and the short fingerprint. The subject tuple is the compact JSON array
`[project, rule.id, rule.version, normalizedTitle]`, where the title uses ECMAScript
`title.toLowerCase().trim().replace(/\s+/gu, ' ')`. Identifier strings stay exact;
numbers, dates, punctuation and Unicode composition in titles are preserved.
The complete definition and a reference hash are in
[DESK_BRIDGES.md](DESK_BRIDGES.md#identified-handoffs-v2-issue-169).
No timestamp, window or measured evidence belongs in the subject tuple.

Run from `observatory/`:

```sh
node adapters/handoff-fixtures.mjs > examples/handoff-fixtures.synthetic.json
node --test tests/handoff-fixtures.test.mjs
```

The generator writes to stdout only. Tests regenerate the complete checked-in
file, so fixture drift cannot pass merely because both an input and its expected
hash were edited together. Consumers should copy the whole corpus byte-for-byte,
record the producer commit and corpus SHA-256, then verify their parser against
each exact `text` string. Never build a separate guessed schema fixture instead.
The per-file Git attribute disables line-ending conversion; a fresh-checkout
regression verifies exact bytes even with `core.autocrlf=true`.

These are positive conformance vectors, not a complete security test suite.
Consumers still need their own duplicate-key, size/depth, malformed-number,
fingerprint, target-mismatch, stale/future and instruction-shaped-text tests.
Test-only transformations from demo to live must remain isolated and never reach
production or create real incidents. Existing consumer references may use different
normalization or serialization; test the exact tuple rather than claiming equivalence.
The title-free opt-in v2 prototype used a different hash. Its old corpus and native
consumer receipts do not prove conformance with the corrected issue #169 corpus.

The fixtures add no telemetry, account connection, task creation or authority.
Native importer acceptance remains a separate tested integration. The default
Desk export is v2; legacy v1 remains an explicit action. The receiver accepts both.
