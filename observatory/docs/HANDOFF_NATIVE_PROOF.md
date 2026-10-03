# Native consumer conformance

The producer and consumer have different repository visibility. Public Pulseboard
CI cannot fetch a private consumer with its repository-scoped token. The initial
native workflow failed during checkout, before exercising intake. Do not add a
cross-repository credential or publish private consumer source to make it green.

`Handoff producer` runs the real producer vectors, hashes and byte-preserving Git
checkout tests on Ubuntu and Windows with Node 22. It also checks the portable
native runner's Python syntax. These checks are producer evidence only.

`tests/handoff-native.py` is the portable integration runner. Execute it in the
consumer's private CI with a reviewed, pinned Pulseboard checkout and the consumer
checkout already available there. Each receipt binds the exact producer and
consumer revisions plus the corpus digest; a moving branch name is not a pin.
The consumer-owned workflow can use its own repository-scoped token for checkout,
without persisting it or exposing it to the test process. Native receipts and
consumer diagnostics stay inside the private repository.

The runner loads the actual consumer parser, preview/apply path and outcome
validator. Only the clock is controlled; registry and production implementation
paths remain native. All twelve producer vectors must preview without writes,
require explicit demo acceptance, create one proposed work item and sidecar,
retain typed provenance and deduplicate imports without changing the original
Markdown item. All intake writes are in temporary campaigns. An audit hook fails
on sockets or child-process execution during the intake exercise.

The wire checks include fourteen malformed inputs and time, mode and target
boundaries. The actual parser must reject duplicate and prototype-shaped keys.
Passing receipts are written only after every assertion succeeds. A checkout
failure, skipped job, syntax-only check or producer-only pass is not a native pass.

From a Pulseboard checkout, using a consumer checkout at a reviewed revision:

```sh
python observatory/tests/handoff-native.py --consumer ../agent-hq --consumer-sha <exact-consumer-SHA> --receipt native-conformance.json
```

The inspected Agent-HQ implementation at 8fe4a86fb14d0177de9b162478dd4ec94836d838
includes the native v1/v2 parser from its #148. That source inspection supersedes
the earlier string-only consumer description, but native proof requires the
paired test run. No default-v2 switch is included here.

This is parser and proposed-file evidence, not Taskdeck, an installed service,
automatic execution, the full consumer suite, or approval of imported text.
Consumer approval policy, concurrent sidecar updates and intent/evidence wording
remain separate responsibilities. The local Pulseboard receiver retains its
exact-file acceptance requirement described in HANDOFF_RECEIVER.md.
