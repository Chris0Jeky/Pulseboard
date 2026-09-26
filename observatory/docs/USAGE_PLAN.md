# Usage measurement plan

**Decided 26 September 2026** (owner answers in chat, recorded as HUMAN_TODO q-13 to q-16).
This file is the architecture for turning the Desk into the place that answers "how are my sites
used, by whom and where do they struggle". It supersedes the Alibi-only scope in `ROLLOUT.md` for
usage counts. It does not replace any privacy boundary in `DESK_ARCHITECTURE.md`.

## Goal and non-goal

The goal is to learn as much as possible about how testers and visitors use each product, for
product improvement, reliability and security. Nothing here is for marketing or advertising.

The non-goal is identifying a person. That means no IP addresses, no user-agent strings, no
fingerprinting, no cross-site or cross-product identifier, and no free text or URLs from the page.
"As much as possible" is read as "as many useful dimensions as possible", not as per-person
tracking.

## Two tiers

| Tier | Who | Default | What is kept | Why |
|---|---|---|---|---|
| **Visitor counts** | Every visitor to a public site | On, with a one-click opt-out that persists | Daily aggregate counts per event × route × release × dimension (below). No row identifies a visit. | Traffic, feature use and failure rates for every site, with nothing that singles anyone out. |
| **Tester journeys** | Enrolled beta testers only | Off until the tester enrols once (invite link or settings switch) | The existing opt-in session events: session-scoped random id, sequence, durations and flows, retained 14 days | This is "how they operate": step order, where they stall, retries, time to complete. The explicit enrolment is what makes session-level detail legitimate. |

The tiers never merge. The Desk shows them side by side and never sums them. That rule already
exists between the statistics reader and the portfolio.

## Dimensions for visitor counts (schema v3)

Every dimension is a closed vocabulary. The collector derives it and stores it only as part of a
daily count key.

- **country**: `request.cf.country` at the collector, stored as ISO alpha-2. A country with fewer
  than 3 counts on a day folds into `other` at read time, so small cells do not single anyone out.
  The IP is never read or stored.
- **device**: `mobile | tablet | desktop`, from the viewport-width bucket the browser sends. No
  user-agent.
- **source**: `direct | search | social | github | internal | other`, classified in the browser
  from `document.referrer`'s hostname against a fixed list. The referrer itself is never sent.
- **visit**: `new | returning`. The first-party marker is one localStorage key holding only the
  current UTC month (for example `2026-09`), and it is cleared on opt-out. It has no identifier,
  so it cannot join visits. It only tells a returning browser from a first visit this month.

Cardinality is bounded by the product of these closed vocabularies. The daily budget still caps
rows.

## Notice: present, not in the way

A tester complained that the current notice gets in the way. The notice cannot be removed: UK and
EU rules on device storage, and the statistical exception Alibi relies on, require clear
information and an easy opt-out. It can be made unobtrusive. The new standard is:

- one line, no modal, no overlay, nothing that blocks input or shifts layout;
- placed in the footer or settings, with the same text in every product;
- wording: "Anonymous usage counts help improve <product>. No personal data. [Turn off]";
- the opt-out works in one click and is remembered; GPC and DNT are honoured silently;
- tester enrolment shows its own one-time explanation, because testers opt in explicitly.

## Two sources, one view, no lock-in

The owner wants both first-party collection and vendor tooling, doing the same jobs, without
depending on the vendor.

- **Pulseboard (system of record).** This is the first-party collector and D1 tables under the
  versioned contract. All product events live only here.
- **Cloudflare Web Analytics (parallel source).** It is cookieless, free, and runs on the
  Cloudflare-hosted sites and, through its JS beacon, on the GitHub Pages sites. A read-only Desk
  adapter pulls its daily visits, countries, devices and referrers through the GraphQL Analytics
  API, bounded in time, bytes and rows, and shows them in the Usage view as a separately labelled
  source. The two are never summed. When they disagree, the difference is itself evidence, such
  as blocked beacons or bot filtering.
- The adapter is one module behind the same evidence-envelope shape as the GitHub connector.
  Replacing or removing the vendor deletes that module and nothing else.

## Delivery slices, in order

1. **Multi-project statistics producer (collector).** Generalise `/v1/collect-stat/<id>` and
   `COLLECT_STAT_PROJECTS` from `alibi` to a list of admitted ids, and generalise the reader and
   Usage view to a project picker. No new dimensions yet. Tests prove each project's isolation,
   origin and budget.
2. **Schema v3 dimensions.** Additive migration adding `country, device, source, visit` to the
   statistics key (existing rows read as `unknown`). The collector derives the country; the
   contract validates the other three. The reader folds small cells. The Usage view gets
   dimension panels.
3. **Unobtrusive notice and embed v2.** Regenerate the statistics embed with the one-line notice,
   the dimension helpers and the month marker, then ship it to Alibi first (Alibi PR, then deploy).
4. **Host rollout.** One PR per host repository, in this order: CommitAtlas, Portfolio, MDviewer,
   then Developer Lens showcase, IdleHarbor and WealthLens. Each adds its id to
   `COLLECT_PROJECTS`/`COLLECT_STAT_PROJECTS` in a Pulseboard PR only after its host PR is ready.
   MDviewer must never send Markdown, filenames or export contents. Developer Lens must prove its
   private build never loads the embed.
5. **Tester tier.** An enrolment switch and invite link in Alibi first, reusing the existing
   opt-in session path and portfolio flows, plus a Desk "Testers" panel with journeys, stalls and
   durations.
6. **Cloudflare Web Analytics adapter.** This needs the owner to enable Web Analytics per site and
   create a read-only Analytics API token (HUMAN_TODO). Then a bounded adapter and a Usage-view
   source toggle follow.

## Legacy workbench

Decision: **freeze, and reuse through adapters.** The FastAPI + Vue workbench keeps building and
stays green in CI, but gets no new features. Its reusable part is the pluggable feed pattern
(`backend/app/feeds/`: `BaseFeed`, registry, manager). Issue #24 carries that pattern into the
Desk as bounded evidence adapters: the Cloudflare adapter in slice 6 is the first adapter written
to that shape, and `http_json`/`system_metrics` feeds can run as a sidecar that produces a Desk
bridge file. After one adapter works end to end, decide whether the rest of the workbench moves to
a `legacy/` directory or a separate repository. Nothing is deleted before that.
