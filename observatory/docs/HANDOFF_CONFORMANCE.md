# Handoff consumer conformance

`examples/handoff-fixtures.synthetic.json` contains 12 deterministic exports from
`makeDemo`, `buildSignals`, `makeHandoff` and `makeIdentifiedHandoff`. Both v1 and
v2 cover the 1/7/14-day windows, a project-specific observation, and a stale
portfolio-wide observation whose project is null. Every fixture is synthetic.

Each case keeps the exact UTF-8 input as `text`, its SHA-256, the full subject
SHA-256 and the short fingerprint. The subject tuple is the compact JSON array
`[project, rule.id, rule.version]`. Strings in this tuple use the producer's
ASCII identifier grammar, avoiding cross-language number or Unicode-normalization
ambiguity. No timestamp, title or measured evidence belongs in the subject tuple.

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
production or create real incidents. Existing title-based consumer references do
not encode mode or this subject tuple; migrate them explicitly rather than
silently claiming equivalence.

The fixtures add no telemetry, account connection, task creation or authority.
Native importer acceptance remains a separate tested integration. The default
Desk export remains v1; v2 remains an explicit action.
