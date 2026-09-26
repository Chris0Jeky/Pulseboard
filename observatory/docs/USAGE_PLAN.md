# Usage measurement plan

**Decided 26 September 2026** (owner answers in chat, recorded as HUMAN_TODO q-13 to q-16).
This file is the architecture for turning the Desk into the place that answers "how are my sites
used, by whom and where do they struggle". It supersedes the Alibi-only scope in `ROLLOUT.md` for
usage counts. It amends three points in `ENGINEERING.md` (see "Amendments" below). It does not
replace any privacy boundary in `DESK_ARCHITECTURE.md`.

## Goal and non-goal

The goal is to learn as much as possible about how testers and visitors use each product, for
product improvement, reliability and security. Nothing here is for marketing or advertising.

The non-goal is identifying a person. Pulseboard's collector stores no IP address, user-agent
string, fingerprint, cross-site or cross-product identifier, free text or page URL. "As much as
possible" is read as "as many useful dimensions as possible", not as per-person tracking.

This is not anonymity. With one or two testers, almost any breakdown describes a person the owner
knows. The protection is that no stored row carries an identifier and the Desk is private to the
operator, not that a row cannot be linked to someone.

## Two tiers

| Tier | Who | Default | What is kept | Why |
|---|---|---|---|---|
| **Visitor counts** | Every visitor to a public site | On, with a one-click opt-out that persists | Daily aggregate counts per event × route × release, plus separate daily totals per dimension (below). No row carries an identifier. | Traffic, feature use and failure rates for every site. |
| **Tester journeys** | Enrolled beta testers only | Off until the tester enrols once (invite link or settings switch) | The existing opt-in session events: session-scoped random id, sequence, durations and flows, retained 14 days | This is "how they operate": step order, where they stall, retries, time to complete. The explicit enrolment is what makes session-level detail legitimate. |

The tiers never merge. The Desk shows them side by side and never sums them. That rule already
exists between the statistics reader and the portfolio.

## Dimensions for visitor counts (schema v3)

Each dimension is stored as its own daily total: `(project, day, dimension, value, n)`. A
dimension is never crossed with another dimension, or with the event, route or release. This keeps
a combination such as "rare country × tablet × returning × this puzzle" out of any stored key.
The table is `WITHOUT ROWID`, so arrival order is not kept either, although repeated reads of a
sparse day can still be differenced by the operator.
Every value comes from a closed vocabulary.

- **country**: Cloudflare derives the country from the connection at its edge and passes it to the
  Worker as `request.cf.country`. The collector stores only that code and never reads or stores the
  IP. Non-ISO codes (`T1` for Tor, `XX`) and missing values become `unknown`.
- **device**: `mobile | tablet | desktop`, from the viewport-width bucket the browser sends. No
  user-agent.
- **source**: `direct | search | social | github | internal | other`, classified in the browser
  from `document.referrer`'s hostname against a fixed list. The referrer itself is never sent.
- **visit**: `new | returning`, fixed once per visit. At the first page load of a tab session, the
  embed reads one localStorage key that holds only a UTC month (for example `2026-09`). If the key
  is absent or older than this month, the visit is `new`; otherwise it is `returning`. The embed
  then writes the key and keeps the answer in sessionStorage, so reloads and later pages of the
  same visit keep it. Both keys hold no identifier and are cleared on opt-out. They cannot join
  visits; they only tell a first visit this month from a later one.

## Notice: present, not in the way

A tester complained that the current notice gets in the way. The notice cannot be removed: UK and
EU rules on device storage, and the statistical exception Alibi relies on, require clear
information and an easy opt-out. It can be made unobtrusive. The proposed standard is:

- one line, no modal, no overlay, nothing that blocks input or shifts layout;
- placed in the footer or settings, with the same text in every product;
- proposed wording: "Aggregate usage counts help improve <product>. Pulseboard stores no
  names, IPs or identifiers. [Turn off]". Never call the counts anonymous: with a handful of
  testers they are not. The Cloudflare beacon is not covered by this line; it gets its own
  wording in slice 6;
- the opt-out works in one click and is remembered; GPC and DNT are honoured silently;
- tester enrolment shows its own one-time explanation, because testers opt in explicitly.

The exact wording needs the owner's approval before slice 3 deploys (HUMAN_TODO q-19).

## Two sources, one view, no lock-in

The owner wants both first-party collection and vendor tooling, doing the same jobs, without
depending on the vendor.

- **Pulseboard (system of record).** This is the first-party collector and D1 tables under the
  versioned contract. All product events live only here.
- **Cloudflare Web Analytics (parallel source).** It is cookieless and free, and covers the same
  sites through its beacon, configured in manual snippet mode only (never automatic edge
  injection). The beacon is loaded by the same embed and obeys the same switch: it
  never loads after "Turn off", or when GPC or DNT is set. The non-goal above binds Pulseboard's
  collector. The beacon is a separate service provider and sends Cloudflare its own page and
  referrer data, so before slice 6 ships, read Cloudflare's current Web Analytics documentation and
  record exactly what the beacon sends and retains. The notice then names Cloudflare.
- A read-only Desk adapter pulls daily visits, countries, devices and referrers through the GraphQL
  Analytics API, bounded in time, bytes and rows. It appears in the Usage view as a separately
  labelled source, never summed with first-party counts. When the two disagree, the difference is
  itself evidence (for example blocked beacons or bot filtering).
- The adapter is one module behind the same evidence-envelope shape as the GitHub connector.
  Replacing or removing the vendor deletes that module, the beacon line in the embed, and the
  notice mention.

## Delivery slices, in order

1. **Multi-project statistics producer (#102).** Generalise `/v1/collect-stat/<id>`,
   `/v1/statistics/<id>` and `COLLECT_STAT_PROJECTS` to a strict list of admitted ids, and give
   the Usage view a site picker. No new dimensions and no host admitted.
2. **Schema v3 dimensions (#103).** Additive migration adding the per-dimension daily totals
   above, a closed vocabulary per dimension, and Usage-view dimension panels.
3. **Unobtrusive notice and embed v2 (#104).** Regenerate the statistics embed with the one-line
   notice, the dimension helpers and the visit markers. Ship it to Alibi first, after q-19.
4. **Host rollout (#105).** One PR per host repository, in this order: CommitAtlas, Portfolio,
   MDviewer, then Developer Lens showcase, IdleHarbor and WealthLens. Each id is added to
   `COLLECT_STAT_PROJECTS` only, in a Pulseboard PR after its host PR is ready. Statistics
   admission does not depend on `COLLECT_PROJECTS` (#110), so a host's identifier-bearing
   `/v1/collect/<id>` stays closed. Session-event collection for a new host is a separate owner
   decision (slice 5 covers Alibi testers). MDviewer must never send Markdown, filenames or export contents. Developer Lens
   must prove its private build never loads the embed.
5. **Tester tier (#106).** An enrolment switch and invite link in Alibi first, reusing the existing
   opt-in session path and portfolio flows, plus a Desk "Testers" panel with journeys, stalls and
   durations.
6. **Cloudflare Web Analytics beacon and adapter (#107).** Wiring the beacon into the embed
   belongs to this slice and needs all of the following first: q-17 (site tokens and read token),
   the vendor data review above, and the owner's approval of the notice line that names
   Cloudflare (a new item like q-19). Only then do the beacon, the bounded adapter and the
   Usage-view source toggle ship.

## Amendments to ENGINEERING.md

This plan changes three statements in `ENGINEERING.md`:

- "Other projects retain opt-in" now means other projects' **session events** stay opt-in. Their
  aggregate counts follow this plan's default-on model, one reviewed host at a time.
- "Opt-in referral categories" becomes default-on source categories inside aggregate counts,
  never referrer URLs.
- Acquisition sources become measurable as categories through the source dimension.

## Legacy workbench

Decision: **freeze, and reuse through adapters.** The FastAPI + Vue workbench keeps building and
stays green in CI, but gets no new features. Its reusable part is the pluggable feed pattern
(`legacy/backend/app/feeds/`: `BaseFeed`, registry, manager). Issue #24 carries that pattern into the
Desk as bounded evidence adapters: the Cloudflare adapter in slice 6 is the first adapter written
to that shape, and `http_json`/`system_metrics` feeds can run as a sidecar that produces a Desk
bridge file. On 2026-09-26 the owner decided to move the frozen workbench under `legacy/` with its
CI paths updated, and it now lives there (HUMAN_TODO q-21, recorded in #115); nothing was deleted.
