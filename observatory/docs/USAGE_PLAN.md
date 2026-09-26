# Usage measurement plan

**Version 2, decided 26 September 2026** (owner answers in chat, recorded as HUMAN_TODO q-13 to q-17
and q-19 to q-21). This file is the architecture for turning the Desk into the place that answers
"how are my products used, by whom, and where do people struggle". It supersedes the Alibi-only scope
in `ROLLOUT.md`. It amends `ENGINEERING.md` (see "Amendments" below). Version 1 of this plan
(visitor counts plus enrolled testers only) shipped slices 1 and 2 (#110, #111). Version 2 widens
what is collected and replaces the tester tier with consent categories.

This is not legal advice. It records the most defensible reading the owner chose; see "Legal basis".

## Goal and non-goal

The goal is to learn as much as possible about how testers and visitors use each product, for
product improvement, reliability and security. Nothing here is for marketing, advertising or sale.

The non-goal is identifying a person. Pulseboard stores no IP address, user-agent string,
fingerprint, name, e-mail, cross-site identifier or cross-visit identifier, and no page URL. Journey
data carries a random id that lives for one tab session only. With one or two testers, almost any
breakdown still describes a person the owner knows: the protection is that nothing stored names
them and the Desk is private to the operator, not that rows cannot be linked to someone.

## Consent categories

Every product loads one Pulseboard SDK (below) with three categories:

| Category | What it sends | Default outside the EEA | Default in the EEA | Kept |
|---|---|---|---|---|
| **Usage counts** | Daily aggregate counts (event × route × release) plus separate per-dimension totals | On | On | 400 days |
| **Diagnostics** | Web-vital timings, JavaScript error summaries, engagement (visible time, scroll depth) | On | Off until OK | 90 days |
| **Journeys and product data** | A per-tab-session random id, ordered product events with bounded JSON properties | On | Off until OK | 90 days |

- Global Privacy Control or Do Not Track turns every category off, silently, whatever the region.
- "EEA" is the EU 27 plus Iceland, Liechtenstein and Norway, taken from Cloudflare's edge country.
  An unknown country is treated as EEA.
- **Choose** includes **Turn all off**, which records the choice with every category off, clears
  every local key (visit marker, session id) and drops anything queued. Turning one category off
  does the same for that category.
- If the region hint cannot be fetched, the SDK treats the visitor as EEA.
- In the EEA the visit marker is not written until the visitor clicks OK or turns a category on;
  until then counts carry `visit: new` and nothing is stored on the device.
- Session replay is out of scope (owner decision): it records screen content.

### The bar

One line, no modal, no overlay, nothing that blocks input. It sits at the top of the page. The SDK
loads with `defer`, so to avoid a layout shift a host puts an empty `<div data-pulseboard-bar>` as
the first element of `body` with a reserved height of 2.5rem; the SDK renders into it and releases
the space once the bar collapses. Without the placeholder the bar is inserted as the first child of
`body` and may shift the page once:

> **Beta** — thanks for helping test <Product>. We collect usage and diagnostics to improve it; no
> names, emails or IPs. [Choose] [OK]

- **OK** records the choice. In the EEA it also turns on Diagnostics and Journeys.
- **Choose** opens three switches in place, each with a one-line description of what it sends, plus
  Save and Turn all off. The descriptions are how journeys and product data are disclosed: the
  owner-approved line itself names only usage and diagnostics (see q-22).
- Once a choice is recorded, the bar collapses to a small **Beta** pill in the bottom-left corner that
  reopens the switches. A host can render the pill inline instead with an element carrying
  `data-pulseboard-slot`.
- The label says "Beta" on every product, which the owner wants anyway to set expectations.
- The Cloudflare Web Analytics beacon is dropped for now (q-17), so the bar names no vendor.

### Legal basis

The owner chose "pre-ticked with an easy opt-out, but in a more legally defensible way", and gated
the EEA. The reading is: UK PECR, as amended by the Data (Use and Access) Act 2025, allows
first-party storage and access for statistical purposes about how a service is used, with a view to
improving it, if the user gets clear information and a simple, free way to object. Everything above is
first-party, used only for product improvement and security, never shared or sold, and the bar is the
information plus the objection. EEA visitors are not covered by that exception, so everything beyond
aggregate counts waits for their OK, and their devices get no visit marker before it. EEA aggregate
counts then store nothing on the device; whether that is enough for the EEA without consent is the
open question in #99. Processing of the stored data (UK and EU GDPR) rests on legitimate interests in
improving and securing the products: pseudonymous data, short retention, no sharing, easy objection. The products are invite-only betas, which lowers the stakes but
does not change the law. Revisit before any product leaves beta or goes to a general audience.

## Data model

### 1. Usage counts: `/v1/collect-stat/<id>`, contract v3

Body: `{ "v": 3, "context": { device, source, visit, scheme, referrer, campaign }, "counts": [...] }`.
Versions 1 and 2 stay accepted. Counts are unchanged: `{ event, route, release, n: 1 }` with
1–20 items from the project's closed vocabulary. Context keys are exact (all six, no others).

| Dimension | Where it comes from | Values |
|---|---|---|
| country | `request.cf.country` | ISO alpha-2; `unknown` for `XX`, `T1`, missing |
| region | `request.cf.regionCode` with the country | `GB-ENG` style, `^[A-Z]{2}-[A-Z0-9]{1,3}$`; else `unknown` |
| browser | User-Agent header, classified on the server, never stored | `chrome edge firefox safari samsung opera other` |
| os | User-Agent header, classified on the server, never stored | `windows macos ios android linux chromeos other` |
| language | first tag of `Accept-Language`, primary subtag | `^[a-z]{2,3}$`; else `unknown` |
| hour | server UTC hour of receipt | `00`–`23` |
| device | browser, viewport-width bucket | `mobile tablet desktop` |
| source | browser, from `document.referrer`'s host against a fixed list | `direct search social github internal other` |
| visit | browser, month marker (below) | `new returning` |
| scheme | browser, `prefers-color-scheme` | `light dark` |
| referrer | browser, the referrer's registrable platform domain from a fixed allowlist (`sdk/referrers.mjs`, shared by the SDK and the collector); subdomains collapse to the platform (`jane.github.io` → `github.io`, `t.co` → `x.com`); `none` when direct or internal | one of the allowlisted domains, else `other`; the collector stores `other` for any off-list host, including from SDK 3.0 builds |
| campaign | browser, `utm_campaign` lowercased | `^[a-z0-9_-]{1,40}$`; `none` when absent; `other` when invalid |

Server-derived dimensions apply to every version. For v1 every browser-derived dimension reads
`unknown`; v2 keeps its device, source and visit, and only scheme, referrer and campaign read
`unknown`. Region, language, referrer and campaign are capped at 50 distinct values per project,
day and dimension; a new value beyond that is stored as `other`, so a forged Origin cannot grow the
table without bound. Campaign tags are chosen by whoever writes the link: never put a person's name
in one.
Each dimension is its own daily total, `statistics_dimensions(project, day, dimension, value, n)`, never
crossed with another dimension or with the event, route or release. The visit marker is one
localStorage key holding only a UTC month (`2026-09`) plus a sessionStorage copy of the answer.

### 2. Product events: `/v1/product/<id>`, contract `pulseboard.product-batch/1`

This is the "plug in anything" channel: diagnostics and journeys both travel here.

```json
{ "v": 1, "session": "<uuid v4> | null", "release": "0.13.0", "context": { "device": "desktop" },
  "events": [ { "name": "puzzle.completed", "route": "puzzle", "seq": 7, "ms": 81234,
                "props": { "puzzle": "castle-3", "seconds": 212, "hints": 1 } } ] }
```

- Top-level keys are exactly `v`, `session`, `release`, `context` and `events`; `context` is exactly
  `{ device }` with `mobile | tablet | desktop`.
- `session` is a uuid only with the Journeys category; Diagnostics-only batches send `null`.
- `release` `^[0-9A-Za-z.+-]{1,32}$`. `name` `^[a-z][a-z0-9_.:-]{0,63}$`. `route` `^[a-z0-9._-]{1,48}$`.
  `seq` an integer from 1 to 1,000,000. `ms`, milliseconds since the page loaded, 0–86,400,000.
- `props` is any JSON object, bounded: nesting depth 4, 32 keys per object, keys
  `^[A-Za-z0-9_.-]{1,48}$`, strings up to 256 characters, arrays up to 32 items, finite numbers,
  2,048 bytes serialized.
- Personal keys are removed on the server before storage: after lower-casing and removing `_ - .`,
  any key equal to `email emailaddress password passwd pwd phone phonenumber mobile token accesstoken
  refreshtoken secret apikey ip ipaddress address streetaddress postcode zipcode ssn iban cardnumber
  cvv dob dateofbirth firstname lastname fullname username nickname displayname player playername user
  handle realname surname givenname userid uid clientip ipaddr remoteaddr url href`. The SDK drops the same keys before sending. Host rule: props
  never carry user-entered free text or identity (names, handles, typed answers); the key list is a
  safety net, not the guarantee. Any string that looks like an e-mail
  address becomes `[email]`, an IPv4 or IPv6 address `[ip]`, and a URL (`scheme://…`) is cut to
  its host. The stored event records how many keys it lost in `redacted`.
- 1–20 events per batch, 16 KiB per request, a daily budget per project (`productLimit`, default
  1,000 events) and a global daily budget across all projects (1,500 events, budget key `*:product`),
  sized so 90 days of product events fit D1's 500 MB free-plan cap (`DESK_ARCHITECTURE.md`).
- The server stores `(project, received, day, session, seq, name, route, release, ms, props,
  redacted, country, region, browser, os, device)`; `device` comes from the batch `context`, the rest
  from the request as for counts. The product budget reuses the `budget` table under the key
  `<id>:product`, so it needs no schema change.
- Admission: `COLLECT_ENABLED` and the id in `COLLECT_PRODUCT_PROJECTS` (exact comma list, same
  rules as `COLLECT_STAT_PROJECTS`). Origin must match the registered project origin.

Reserved names the SDK emits under Diagnostics:

| Name | Props |
|---|---|
| `web.vital` | `{ metric: LCP INP CLS FCP TTFB, value, rating: good needs-improvement poor }` |
| `js.error` | `{ kind, message (160 chars, e-mails and long digit runs masked), source (file name only), line }` |
| `page.engaged` | `{ seconds, scroll }`, sent once when the page is hidden |

Everything a product sends through `Pulseboard.track(name, props)` is a Journeys event.

### 3. Region hint: `GET /v1/consent/<id>`

Origin-checked, no authentication, no storage. Returns `{ "v": 1, "region": "eea" | "other" }` from
`request.cf.country`, with `Cache-Control: private, max-age=3600`. The SDK caches it in sessionStorage.

### 4. Reads for the Desk (authenticated)

- `/v1/statistics/<id>?days=1|7|14|30|90` returns `pulseboard.statistics/4`: v3 plus the eight new
  dimensions.
- `/v1/product/<id>?days=…` returns `pulseboard.product/1`: totals by name, route, release and day;
  sessions (count, median events, median duration); journeys (the latest 100 sessions as ordered name
  lists with durations); the last step before a session ends ("exits"); vitals as p75 per metric and
  route, computed from raw values (never an average of percentiles); errors grouped by kind and
  message.
- `/v1/product/<id>/events?days=…&name=…&limit=…` returns up to 5,000 raw events, newest first, for
  the generic explorer and the per-product panels.

## The SDK (`observatory/sdk/`)

One dependency-free module, built per project into a single classic script the host serves itself
(`npm run build:sdk -- <id>`), replacing the Alibi-specific statistics embed. The host adds one
`<script src="/pulseboard.js" defer>` and, optionally, `Pulseboard.route('puzzle')` on navigation
and `Pulseboard.track('puzzle.completed', {...})` for product events. It never blocks the product:
every failure is silent and drops data, and nothing is queued offline across page loads.

## Desk

- **Usage**: every dimension above, windows of 1, 7, 14, 30 and 90 days.
- **Product** (new view): a generic explorer for any project (names, property breakdowns, numeric
  histograms, recent events), journeys and exits, diagnostics (vitals p75 per route, errors).
- **Product panels**: a plugin per product, `public/products/<id>.mjs`, registered by id. Alibi's is
  first: per puzzle, starts, completions, failures, hint use, solve-time distribution and where
  people give up.

## Delivery slices, in order

1. Done: multi-project statistics (#110).
2. Done: schema 3 dimensions (#111).
3. **Collector v4 (#104 re-scoped):** schema 4 (product events, retention changes), contract v3 counts,
   product ingest and reads, region hint, windows 30 and 90.
4. **SDK v3:** the module, the bar, categories, EEA gating, diagnostics, journeys, `track`, builder.
5. **Desk v4:** Usage dimensions and windows, Product view, plugin registry, Alibi panel.
6. **Host wave (#105):** one PR per host repository, all at once (owner decision), Alibi first to
   merge. Each host's ids go into `COLLECT_STAT_PROJECTS` and `COLLECT_PRODUCT_PROJECTS` in one
   Pulseboard PR after the host PRs are ready. MDviewer must never send document text, file names or
   export contents; Developer Lens must prove its private build never loads the SDK.
7. Cloudflare Web Analytics adapter (#107): dropped for now (q-17).

The legacy `/v1/collect/<id>` session route stays for the Alibi builds already deployed and is
retired once no host loads the old embed.

## Amendments to ENGINEERING.md

- Default-on now covers usage counts everywhere, and diagnostics and journeys outside the EEA, with
  the bar as notice and objection. Session-level data is no longer opt-in only.
- Referral categories, allowlisted referrer platform domains and campaign tags are default-on inside
  aggregate counts; referrer URLs, paths and any off-list host (which can carry a name) are never sent or
  stored (SDK 3.1, CommitAtlas#247).
- Product events carry bounded open JSON properties, not a closed vocabulary. Their contract bounds
  shape and size and removes personal keys; it does not make them content-free.
- Retention: detailed data (session events and product events) 90 days, aggregates 400 days.
- Web vitals come from the SDK's own PerformanceObserver code. Its INP is an approximation and is
  labelled so in the Desk.

## Legacy workbench

Decision (q-16, confirmed q-21): frozen, and moved under `legacy/` with CI paths updated. Its feed
pattern (`legacy/backend/app/feeds/`: `BaseFeed`, registry, manager) is the model for Desk adapters (#24).
