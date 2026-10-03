# Retaining separately reviewed observations

The local receiver keeps the first accepted proposal immutable. By default,
accepting changed evidence for the same subject returns `repeat-observation`
without storing it. An operator may now add `--retain-observation` to retain that
new evidence in a separate file. This is an extension of
[the local receiver](HANDOFF_RECEIVER.md), not a Taskdeck or Agent-HQ importer.

First preview the new input. Acceptance requires its exact reviewed file hash,
even when a previous observation for that subject was approved:

```sh
node adapters/receive-handoff.mjs --input changed.json --project alibi
node adapters/receive-handoff.mjs --input changed.json --project alibi --accept --reviewed-sha256 <hash-from-this-preview> --output-dir <existing-private-directory> --retain-observation
```

Demo input still needs `--allow-synthetic`. Source-stale or expired input still
needs `--allow-stale`, evaluated at acceptance time. Future evidence is refused.
Selecting retention without `--accept` remains a write-free preview.

The original path, status and `unchanged: true` remain in the result. The new
`observation` field reports `created` or `duplicate`, its path and whether that
history file was unchanged. Its name combines the existing mode, target and
subject fingerprint with `.observation-<full-content-SHA-256>.json`.

Each history file uses the existing closed `pulseboard.proposal/1` data format:
typed evidence, source schema/time/window, full subject and content digests,
original input byte hash, review time, freshness acknowledgements, fixed
verification guidance, proposed status and no permissions. It is inert history,
not another task or a newly authorized action. It does not authenticate the source.

Publication uses the same flushed temporary file and exclusive hard-link operation
as the original receiver. Concurrent imports of identical content publish once;
distinct content gets distinct files without a shared mutable index. A duplicate
keeps the first receipt and review time, even when a reformatted input has a new
byte hash. Root and history collisions are parsed and fully checked before they
are accepted as duplicates. Corruption, symlinks or different valid content at an
expected history path are refused, not overwritten.

Keep the directory private and owner-controlled. Do not bulk-import every JSON
file as a task: the root file is the proposal, and observation-suffixed files are
history. Each explicit acceptance adds at most one bounded file; there is no
automatic retention period, directory-size cap, background collection or cleanup.
The owner may delete selected history files without changing the original. There
is no claim of a transactional directory snapshot or cross-process tamper protection.

Run from `observatory/`:

```sh
node --test tests/handoff-observations.test.mjs
npm test
```

The regressions cover default behavior, exact-byte review, immutable originals,
mode/target separation, both wire versions, stale/future/synthetic boundaries,
corruption and symlinks, concurrent same/different observations and the real CLI.
All data is synthetic and all receiver writes are in temporary directories.
