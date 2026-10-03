# Native Agent-HQ conformance

`Handoff native` tests the current Pulseboard producer against the already merged
Agent-HQ revision `8fe4a86fb14d0177de9b162478dd4ec94836d838`, which contains its
native v1/v2 intake repair (#148). The consumer is pinned, not silently downloaded
from a moving default branch. This supersedes the earlier observation that the
old HQ importer accepted only string-shaped legacy envelopes. It does not switch
the Desk's default v1 action; identified v2 remains explicitly selected.

The workflow runs on Ubuntu and Windows with Node 22 and Python 3.13, without
additional dependencies or a write token. It regenerates/verifies the producer's
12 synthetic vectors, exact byte hashes, fingerprints and CRLF checkout behavior.
It then loads the actual consumer parser, preview/apply path and outcome validator.
Only the clock is controlled; the registry and all production implementation paths
remain native. Each vector must preview without writes, require explicit demo
acceptance, create one proposed work item and sidecar, retain typed provenance,
and deduplicate subsequent imports without changing the original Markdown item.
No executable probes or external actions may be created. An audit hook fails on
network sockets or child-process execution during the native intake exercise.

Wire checks reject malformed time, source, window, identity, bounded evidence and
unknown fields. The real intake parser rejects duplicate/prototype-shaped keys.
All files created by intake are temporary. The workflow verifies neither checkout
was changed and retains a compact receipt with both revisions, the corpus digest,
OS/Python versions and completed case counts. Receipt creation happens only after
all assertions pass; a workflow failure cannot produce a passing receipt.

This is native parser and proposed-file evidence, not an installed Agent-HQ
service, a Taskdeck integration, an execution loop, or proof that arbitrary
instructions in a proposal are safe to execute. Native review/approval policy,
concurrent sidecar updates and importer intent/evidence wording are separate
consumer responsibilities. The Pulseboard local receiver continues to offer its
stricter exact-file acceptance path described in HANDOFF_RECEIVER.md.

To rerun with a locally checked-out consumer at the pinned revision:

```sh
python observatory/tests/handoff-native.py --consumer ../agent-hq --consumer-sha 8fe4a86fb14d0177de9b162478dd4ec94836d838
```

Changing the consumer revision or corpus digest requires a reviewed change and
new native receipts. A green run against a pinned consumer does not certify every
later consumer revision or the entire Agent-HQ test suite.
