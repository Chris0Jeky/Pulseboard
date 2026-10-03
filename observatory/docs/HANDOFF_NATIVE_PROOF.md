# Producer and native consumer conformance

The producer and consumer have different repository visibility. Public Pulseboard
CI cannot fetch a private consumer with its repository-scoped token. The initial
native workflow failed during checkout, before exercising intake. Do not add a
cross-repository credential or publish private consumer source to make it green.

## Which gate proves what

`Handoff producer` runs the real producer vectors, hashes and byte-preserving Git
checkout tests on Ubuntu and Windows with Node 22. It also checks the portable
native runner's Python syntax. These checks are producer evidence only.

Agent-HQ already owns native conformance tests in `tests/test_intake_producer.py`,
added in its PR #149. Its ordinary repository suite discovers them. They use the
exact public synthetic corpus introduced by Pulseboard #193, with SHA-256
`dfe57fddc4f412b4ff2511528802651297283719469e4d4bac77028d6d909241`.
Do not add a second consumer workflow just to duplicate those tests. Report their
actual execution result: merged test code, checkout failures and skipped jobs do
not establish that native tests passed. Keep private diagnostics in that repository.

## Supplementary paired runner

`tests/handoff-native.py` can run in an owner-controlled workspace with both
reviewed checkouts. A consumer may also invoke it from its existing private CI
with a pinned public Pulseboard checkout. The receipt records both actual revisions
and the corpus digest. The caller must select and review the producer revision;
the script does not establish that a checkout is clean or authenticate its source.

The runner exercises the consumer parser, preview/apply path and outcome validator.
The intake clock is fixed; registry and implementation paths are not replaced.
All twelve producer vectors must preview without writes, require explicit demo
acceptance, create one proposed work item and sidecar, retain typed provenance,
and deduplicate imports without changing the original Markdown item. Intake writes
use temporary campaigns. The audit hook detects subprocess launches and socket
connect/bind calls during the exercise; it is a test tripwire, not a security sandbox.

Fourteen malformed wire cases and time, mode and target guards are checked.
The actual parser must reject duplicate and prototype-shaped keys. A receipt is
written after the assertions pass. Run with normal Python assertions enabled,
not `python -O`. A syntax-only or producer-only pass is not a paired-run pass.

```sh
python observatory/tests/handoff-native.py --consumer ../agent-hq --consumer-sha <exact-consumer-SHA> --receipt native-conformance.json
```

No paired-run success is claimed by the public workflow. The consumer's native
v1/v2 implementation supersedes the old string-only profile, but later consumer
revisions need their own evidence. This is not Taskdeck integration, an installed
service, automatic execution, or approval of imported text. Consumer approval,
concurrency and intent/evidence presentation remain separate responsibilities.
The local receiver retains the exact-file acceptance requirements in
[HANDOFF_RECEIVER.md](HANDOFF_RECEIVER.md).
