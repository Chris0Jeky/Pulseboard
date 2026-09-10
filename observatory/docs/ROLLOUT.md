# Portfolio rollout

No host PR in this rollout changes the native apps' no-telemetry promises. The collector is deployed with scheduled probes on since 2026-09-10 and admits browser events for the projects listed in `COLLECT_PROJECTS` only (Alibi, the owner's first pilot, since the same day; `HOSTING.md`); the admission gate below has been run and passed on that date.

| Repository / surface | Integration boundary | Valuable next signals |
|---|---|---|
| MDviewer | Public browser app only; empty endpoint; no Markdown, filenames or export contents | Print requested vs actual raster PDF completion; render timing and fixed failure classes |
| CommitAtlas | Landing and Studio web UI; not profile SVG image tracking | Studio entry, generation success, export/copy requested, server cache efficiency separately |
| Alibi | Hashed public build; offline/standalone disabled | Puzzle starts/completions/hints, fixed genre, recovery, optional castle exploration; no puzzle answers or saves |
| Developer Lens | `showcase` build only, exact public origin/path | Story progression and share requests; never the local private lens or exported portable reports |
| Taskdeck | Existing consent implementation hardening and readiness manifest | v0.4 reviewed adapter using approved events; preserve v0.3 zero egress and CSP |
| IdleHarbor | Public site/distribution only | Download requests vs release asset counts; native program stays no-telemetry |
| CV_and_Portfolio | Production portfolio page only | Project interest and contact-link requests, not claimed leads or hires |
| wealthlens-hq | Published dashboard/site only | Chart exploration, source opens, share requests; no political user profiling |
| Pulseboard | Isolated Observatory module | Its own liveness/readiness and independent external monitoring |

Future-ready candidates: NavSentinel, developer-lens-lab, collaborative-hill-lab, extract-api, SwarmingLilMen, agent-harness, llm-release-gate, DevFoundry and RepoScope. Publication must be verified before adding a live probe or collecting anything. A public source repository is not evidence of a deployed product. Archived coursework, forks and private employment/client repositories are excluded.

## Hosted smoke test before activation

Run this against a preview deployment, before any public pilot, and record the actual results.

1. Deploy a preview Worker against a scratch D1 database and set `COLLECT_ENABLED` to `"true"` and `COLLECT_PROJECTS` to the test projects for that preview only.
2. Post one valid batch of one event to `/v1/collect/<test project>` with the project's exact `Origin` header.
3. Assert the response is **202**, and that `SELECT COUNT(*) FROM events` on the preview database is exactly **1**.
4. Post the identical batch again: expect 202 with the row count still 1 (deduplication). Then exercise the budget path the way the unit test does: every registered project has `dailyLimit` 1000 while a batch holds at most 20 events, so an oversized batch is refused with **400** by the contract, never 429. Temporarily set the test project's `dailyLimit` to 1 in `src/projects.mjs`, redeploy the preview, post a two-event batch and expect **429** with `Retry-After` and no new `events` or `budget` rows; restore the limit afterwards.
5. Check `/readyz` returns 200 with the expected `schema` number against that same database.
6. Prove retention runs through the deployed entrypoint: seed a row older than the retention window, trigger the
   scheduled handler (`npx wrangler dev --test-scheduled` and `GET /__scheduled` locally, or wait for a cron tick on
   the hosted Worker) and confirm the row is gone while the rows that tick wrote remain.

The `preview` environment in `wrangler.jsonc` is that preview (collection on, no cron, the scratch database
`pulseboard-observatory-scratch`), and `tests/hosted-admission.mjs` posts one contract-valid batch and asserts the
status; `HOSTING.md` records the 2026-09-10 run. Delete the preview Worker afterwards (`npx wrangler delete --env preview`).

This step is not redundant with `npm test`. The 202-versus-429 decision reads `result[0].results.length` from an `INSERT … RETURNING` executed inside a D1 `batch()`. Local tests prove that behavior against `node:sqlite` only; whether D1 returns rows for a `RETURNING` statement in a batch, and whether a guarded upsert that admits nothing returns an empty result rather than no result set, is a hosted property that has not been measured. If step 3 fails, do not activate: a wrong reading here silently admits or refuses every batch.

## Activation order

First deploy the isolated collector with collection disabled. Verify authentication, migrations and probe behavior. Review target origins and the monitoring cadence. Configure an independent check of the collector from another provider. Then activate one public pilot, preferably CommitAtlas, with an updated notice and the generated consent control. Inspect a real accepted payload and exercise withdrawal, GPC and failed transport before expanding.

On 2026-09-10 the owner chose Alibi as the first pilot and approved its notice (Pulseboard
HUMAN_TODO q-7); `HOSTING.md` records the activation. MDviewer still requires an explicit
notice/release review before any remote collection. Developer Lens additionally needs tests proving the private/local build and standalone exports never load the integration. Taskdeck is not a pilot: its approved release-specific zero-egress policy remains binding.

## Human configuration

The remaining human choices are deployment credentials/account, high-entropy dashboard secret, acceptable account spending notifications, reviewed privacy notice and the first pilot to activate. Nothing requires a new paid analytics subscription. That does not make hosting guaranteed free.

## Agent handoff

Read this file and ENGINEERING.md. Run `npm test` inside observatory, inspect each PR against the current branch, and run that host repository's existing checks. Preserve ongoing unrelated work. Review the generated lock file and never overwrite local SDK edits silently. Keep endpoints empty until the operator has deployed the collector and approved the notice. Record the exact hosted validation results, not a generic claim that local tests prove production readiness. Open focused follow-up PRs for semantic action hooks and alerting rather than hiding unfinished modules behind active UI claims.
