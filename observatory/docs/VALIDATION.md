# Validation record

58 Node tests passed locally, using real SQLite for collector persistence and transaction checks. The generated SDK was also evaluated with Alibi's standalone flag on the public origin and refused collection.

Offline Chromium checks passed using mocked transport: empty live-shaped response, token clearing, synthetic demo, aggregate JSON download, 390px viewport overflow, disconnect and no page errors. Desktop and mobile screenshots were inspected. This is not live browser HTTP validation: browser navigation to the local server was blocked by the execution environment.

Not verified: actual Cloudflare account deployment, hosted D1 integration, production collection, complete host-project builds, or every app-specific success event. The integration PRs must run their normal CI and release checks before activation.
