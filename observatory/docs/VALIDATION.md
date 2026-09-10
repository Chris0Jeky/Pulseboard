# Validation record

58 Node tests passed locally on the final packaged kit, using real SQLite for collector persistence and transaction checks. The generated SDK was also evaluated with Alibi's standalone flag on the public origin and refused collection. Seven staged browser artifacts passed local checksum and inactive-runtime checks.

Offline Chromium checks passed using mocked transport: empty live-shaped response, token clearing, synthetic demo, aggregate JSON download, 390px viewport overflow, disconnect and no page errors. Desktop and mobile screenshots were inspected. This is not live browser HTTP validation: browser navigation to the local server was blocked by the execution environment.

The central Observatory GitHub Actions run passed at commit `8d92fff11f581d600c357e402cd521426665f318`. MDviewer CI and Developer Lens PR gate also passed. Later corrections to other integrations are described in `PR_INDEX.md`; consult the current PR checks rather than treating this snapshot as a promise that every host is green.

Not verified: actual Cloudflare account deployment, hosted D1 integration, production collection, all host checks at their final revisions, or every app-specific success event. No real customer traffic was collected. Application PRs remain drafts pending their release gates.
