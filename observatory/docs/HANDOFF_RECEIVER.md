# Reviewed handoff files

The executable sample receiver advances #22 and the producer identity in #169. It creates
**local proposal JSON**, not native Taskdeck cards, agent jobs or live incidents. No credential,
network, shell or execution operation is available through this path. Imported text remains data.

## Preview, then accept

From `observatory/`, with an existing Desk export:

```sh
node adapters/receive-handoff.mjs --input handoff.json --project alibi
```

The preview shows the original source mode, timestamp, window, rule version, exact proposed
fields, computed identities and warnings. It does not create an output directory or file.
The project must be a registered Pulseboard id and match the source project exactly. A
portfolio-wide observation (`project: null`) requires an explicit destination project.

Create a private, owner-controlled local directory yourself, review the preview, then use its
**reviewedFileSha256** value, not the content hash or signal fingerprint:

```sh
node adapters/receive-handoff.mjs --input handoff.json --project alibi \
  --accept --reviewed-sha256 <64-hex-reviewed-file-hash> --output-dir ./proposals
```

Synthetic inputs additionally require `--allow-synthetic`; stale inputs require `--allow-stale`.
These switches accept storing a **proposal**, not believing its claims or executing its text.
A failed source refresh (`stale: true`) and a receipt older than 30 minutes each require stale
acceptance. Future-dated evidence is refused, even with `--allow-stale`. Acceptance re-reads the
file and recomputes age, so a file changed after preview or evidence that aged out cannot silently pass.

A proposal retains structured evidence, the source's original time and synthetic mode, an
empty `permissions` list, and verification-first guidance. Review time is separate from source time.
The original three boundary strings are retained as source claims, never interpreted as permissions.
No part of this path publishes data to the public Desk export or collector.

## Three identities, not three kinds of authority

| Field | Meaning |
| --- | --- |
| `reviewedFileSha256` | SHA-256 of the exact UTF-8 input bytes; even whitespace changes require review again. |
| `contentSha256` | SHA-256 of deterministic JSON with recursively sorted object keys; array order remains significant. |
| `signalSha256` / `fingerprint` | SHA-256 of UTF-8 `JSON.stringify([project, rule.id, rule.version])`; the fingerprint is its first 12 lowercase hex characters. |

The Desk-native subject tuple omits title, evidence, window, timestamp and stale flag so refreshes
and wording changes do not create new subjects. `null` is different from a project named `portfolio`.
**Mode and destination project partition receiver storage**, so demo and live data, or separately
mapped portfolio observations, cannot fold into the same card. A full signal digest is checked
before accepting a short-fingerprint collision as a repeat. All hashes are unsigned identifiers,
not proof of source authenticity, freshness, human approval outside this local import, or causality.

Repeated canonical content returns `duplicate`; new evidence for an existing subject returns
`repeat-observation`. Both leave the original reviewed proposal untouched and name its file.
They do not imply that the new evidence was attached to it. A later native integration must offer
an explicit reviewed update, not silently replace accepted evidence.

## Producer compatibility and bounds

`makeHandoff` remains the synchronous **v1** exporter. The async
`makeIdentifiedHandoff(snapshot, signal, stale)` in `public/desk-handoff.mjs` produces **v2**, preserving
all v1 fields and adding the verified fingerprint. The receiver accepts both real contracts.
The default Desk export is deliberately not switched until consumers support them.

Current Agent-HQ `scripts/intake.py`, inspected at `6d296c69c19830973dbedb8ce66dcda70ebf9f5f`,
accepts only schema 1 and expects string `generatedAt` and `evidence`. Real Desk exports have a
numeric millisecond timestamp and structured aggregate evidence. Its title/casefold-based fallback
fingerprint is also not this new subject identity. Do not claim compatibility by renaming schema 1
to 2. Coordinate a separately tested consumer change with real producer fixtures before switching
that path. Native Taskdeck import, estate-console proposal staging and re-observation remain #22 work.

Input is strict UTF-8 JSON, at most 256 KiB. Only exact contract fields and `live`/`demo` modes are
accepted. Duplicate JSON keys (including escaped aliases), prototype-shaped keys, unknown fields,
unsupported versions, mismatched v2 fingerprints and inconsistent windows are rejected. Source
window is an exact 1/7/14-day UTC window ending at the numeric generation time. Timestamps are
safe integers from the Unix epoch through year 9999. Title/observation/next-check bounds are
240/2000/1000 UTF-16 code units, with three nonempty boundary strings of at most 500 each.
Evidence stays an object, at most eight nesting levels, 1024 values, 128 array entries per array,
2048 code units per string and 80 per key. No event-row or arbitrary command interpretation exists.

## Filesystem guarantees and limits

Files are read through bounded regular-file descriptors; leaf symlinks and malformed UTF-8 are
refused. Output requires an existing directory whose leaf is not a symlink. Its ancestors and
permissions are the caller's responsibility; this is **not** a sandbox against a hostile process
that can replace directories on the same machine.

Publication writes and syncs a mode-0600 temporary file, then hard-links it exclusively to the
validated destination filename. Concurrent writers produce one complete card, never a partially
written destination. Existing files, including malformed files or identity collisions, are never
overwritten. A filesystem without hard-link support fails closed; no non-atomic fallback is used.
Windows permissions follow filesystem ACLs, so mode 0600 is not an ACL guarantee. Sudden power
loss durability of the directory entry is not asserted. The owner controls local retention and deletion;
there is no background process, database migration, scheduled deletion or subscription.

## Proof commands

```sh
node --test tests/handoff.test.mjs tests/handoff-receiver.test.mjs
npm test
```

Tests use actual `makeHandoff`, `makeDemo` and `buildSignals` output, plus explicit negative inputs.
They cover exact-byte approval, no-write previews, stale/synthetic gates, future rejection,
malformed input, collision refusal, symlinks, concurrent exclusive publication, stable identity,
source/target partitioning and the real CLI. No hosted D1, native consumer or screen-reader result
is implied by these local file tests.
