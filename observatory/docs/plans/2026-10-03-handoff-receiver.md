# Reviewed handoff receiver implementation plan

Goal: turn real Pulseboard exports into inspectable, explicitly accepted local proposal files, never executable instructions.

Spec: `../HANDOFF_RECEIVER.md`. Node 22, native ESM, no dependencies, no collection or database changes.

## Design decisions

- Preserve the existing synchronous `makeHandoff` v1 export while the strict Agent-HQ consumer is reconciled. Provide an explicit async v2 producer with the same fields plus `fingerprint`.
- Signal identity is SHA-256 of the JSON tuple `[project, rule.id, rule.version]`; unlike the old consumer's title-based fingerprint it survives changes in wording, time and measured evidence. Display the first 12 hex characters, retain the full digest for collision checks. Receiver keys additionally include mode and destination project.
- Exact reviewed-file SHA-256 authorizes only accepting those bytes. Canonical content SHA-256 distinguishes semantically identical JSON. Neither authenticates an unsigned source or grants execution permission.
- Preview makes no writes. Accept re-reads and validates the file, verifies the reviewed-file hash, recomputes age and requires explicit synthetic/stale acceptance. Future-dated evidence is refused. Existing proposal files are never overwritten; repeated signals are reported for review rather than silently replacing evidence.
- Only explicit caller paths are used. Read regular files within byte limits; require an existing owner-controlled output directory. Publish one complete mode-0600 JSON proposal atomically with an exclusive hard link, failing closed if unsupported. No network, shell, account, Taskdeck or agent execution.

## Tasks and proof

- [x] Add failing tests using actual `makeHandoff(makeDemo(...), buildSignals(...)[0])`, not a separately invented envelope.
- [x] Implement `public/desk-handoff.mjs`: bounded closed parsing, v1/v2 identity, `makeIdentifiedHandoff`, exact preview, explicit freshness/source boundaries. Test duplicate/unknown keys, bounds, timestamp/window consistency, fingerprint tampering, target mismatch and inert instruction-shaped text.
- [x] Implement `adapters/receive-handoff.mjs`: bounded file input, no-write preview, exact-byte acceptance and exclusive publication. Test consent flags, changed bytes, duplicate/repeated observations, mode/target separation, symlinks, malformed existing files and concurrent writers.
- [x] Run full `npm test`, negative mutation controls and real CLI fixtures. Document commands and migration limits. Review current consumer before any default v2 switch.
- [ ] Publish draft PR from current remote main, obtain exact-head CI and Codex review, resolve findings, merge only verified work. Keep #22 native integration open.

## Review focus

Changed input between preview and accept; synthetic data colliding with live data; proposal identity collision; malformed or oversized local files; read time advancing past the freshness boundary.

Local evidence: 20 focused tests and the full 546-test Observatory suite passed on Node 22.16/Linux. Removing the exact-file comparison, mode partition or stale gate independently made receiver tests fail; each mutation was restored. Consumer compatibility remains explicitly pending.
