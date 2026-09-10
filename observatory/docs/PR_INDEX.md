# Portfolio Observatory PR index

Rollout prepared on 10 September 2026. These are review branches, not merged deployments. The central kit is runnable; application integrations remain drafts and all collection endpoints are empty. Deployment and the first consented pilot are still required.

| Repository | Pull request | Included change |
|---|---|---|
| Pulseboard | https://github.com/Chris0Jeky/Pulseboard/pull/15 | Shared collector, dashboard, probes, SDK, installer, tests and documentation |
| MDviewer | https://github.com/Chris0Jeky/MDviewer/pull/67 | Inactive public-site adapter; document privacy remains unchanged |
| CommitAtlas | https://github.com/Chris0Jeky/CommitAtlas/pull/199 | Inactive web UI adapter; SVG traffic is not treated as unique people |
| Alibi | https://github.com/Chris0Jeky/Alibi/pull/83 | Application-bundle adapter before hashing; small boot diagnostics and standalone privacy preserved |
| Taskdeck | https://github.com/Chris0Jeky/Taskdeck/pull/2862 | Consent retry race fix, five regression tests, local-first integration boundary; no injected tracker |
| developer-lens | https://github.com/Chris0Jeky/developer-lens/pull/329 | Synthetic showcase-only adapter; private/local builds excluded |
| IdleHarbor | https://github.com/Chris0Jeky/IdleHarbor/pull/80 | Website-only adapter; native executable stays unchanged |
| CV_and_Portfolio | https://github.com/Chris0Jeky/CV_and_Portfolio/pull/3 | Portfolio page adapter; biography, CV and archives unchanged |
| wealthlens-hq | https://github.com/Chris0Jeky/wealthlens-hq/pull/599 | Public dashboard adapter; backend and pipelines unchanged |

## Review status

The shared kit passed 58 local tests using real SQLite. Its Observatory GitHub Actions run passed at commit `8d92fff11f581d600c357e402cd521426665f318`. MDviewer CI and Developer Lens PR gate also passed on the submitted branches.

CI identified two integration issues that were corrected without removing the relevant checks: unused server-only constants in the CommitAtlas browser artifact, and Alibi's boot-script size budget. Alibi now includes the SDK in the application bundle, not the boot diagnostics. WealthLens formatting identified a generated, checksum-locked SDK; only that generated artifact was excluded from reformatting, matching the ownership check. Read each PR's current check results before approval. A completed local check does not prove a hosted deployment works.

## What is and is not wired

After explicit activation and user consent, public adapters can emit a page view and a content-free error occurrence. Application-specific event names, routes and release dimensions are registered extension points. Most success/failure journey hooks have not yet been connected to their application operations; no genuine completion funnel should be expected until those hooks and tests are added.

Outbound paging, GitHub traffic imports, Web Vitals, full distributed tracing, returning-user cohorts, experiment assignment and automated AI analysis are documented extensions, not implemented claims. Current monitoring exposes reachability state in the dashboard and distinguishes missing/stale signals from healthy ones.

## Next execution pass

Review the central PR, run its tests and local dashboard, then check each host PR against the latest base branch and its normal CI. Deploy the isolated collector with collection off. Set a dashboard read secret and verify authentication, migrations and independent collector monitoring. Configure one public pilot, preferably CommitAtlas, only after the notice and CSP review. Wire and test its primary real success/failure operation. Then expand to the other public sites. Preserve Taskdeck, MDviewer, Developer Lens and IdleHarbor's stricter boundaries.

Use `docs/ROLLOUT.md` for activation gates and `docs/ENGINEERING.md` for design decisions, threat assumptions, measurement semantics and extension priorities. Do not put dashboard credentials into browser builds. Do not label clicks as completions, installations or confirmed leads.
