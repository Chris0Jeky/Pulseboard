# Pulseboard SDK v3: host integration

The SDK is slice 4 of the usage plan (`USAGE_PLAN.md`, version 2). It is one dependency-free module,
`observatory/sdk/pulseboard-sdk.mjs`, built per project into a single classic script that the host serves
from its own origin. It replaces the Alibi-only statistics embed (`adapters/stat-embed.mjs`) once the host
wave (slice 6) lands; nothing here changes the collector's admission lists.

## Build and install

```sh
cd observatory
npm run build:sdk -- alibi                                   # print the artifact to stdout
npm run build:sdk -- alibi ../../Alibi public/pulseboard.js   # write it inside a host checkout
npm run build:sdk -- alibi ../../Alibi public/pulseboard.js 0.12.0   # pin a registered release
```

- The project must be registered in `src/projects.mjs` with a public origin. The release defaults to the
  newest registered release and must be one of them (counts only accept the registry's closed list).
- The output is deterministic and LF-only. Its header names `pulseboard-sdk 3.2.0`, the project, and the
  SHA-256 of the body below the header. The writer refuses absolute paths, `..`, symlinked parents that
  leave the repository, symlink targets, the installer's reserved paths, and any existing file that is not
  an unedited SDK artifact (the header hash must match), so it never overwrites host code.
- The artifact embeds only the client contract: id, label, origin, collector
  (`https://pulseboard-observatory.commit-atlas.workers.dev`), release, and the project's event, route and
  release vocabulary. Probe targets, markers and budgets stay operator data.

## Add it to a page

```html
<script src="/pulseboard.js" defer></script>
```

The script only runs on the registered HTTPS origin, never under automation (`navigator.webdriver`), and
does nothing else until the DOM is ready. A second copy on the same page is ignored.

### Content Security Policy

```
script-src 'self';
connect-src https://pulseboard-observatory.commit-atlas.workers.dev;
```

No `style-src` change is needed: the notice is styled through `element.style` (the CSSOM), which a strict
`style-src` without `'unsafe-inline'` does not block. The SDK writes no `style` attribute, no `<style>`
element and no HTML strings. Every element carries a `pb-` class, so a host stylesheet may restyle it.

## API

```js
Pulseboard.route('puzzle');                      // a navigation: records page.view for the route
Pulseboard.count('puzzle.started');              // an aggregate count from the closed vocabulary
Pulseboard.track('puzzle.completed', { puzzle: 'castle-3', seconds: 212, hints: 1 }); // a journeys event
Pulseboard.consent.get();   // { counts, diagnostics, journeys, decided, region, blocked }
Pulseboard.consent.set({ journeys: false });     // records a decision, as the switches do
Pulseboard.consent.open();  // opens the switches (for a "Privacy choices" link)
Pulseboard.version;         // '3.2.0'
```

Every call returns `true` when the item was queued and `false` when it was dropped. Nothing throws into the
host. Unknown events are dropped; an unknown route becomes `other` when the vocabulary has it, else `home`.
`page.view` is recorded on load and on every `route()` call.

The landing route defaults to `home`. A page that is not the home route names its own so a direct visit
records one view for the right route, not `home` and then the real one:

```html
<html data-pulseboard-route="studio">
```

The attribute is read once at mount and used only when it names a registered route; an explicit
`Pulseboard.route()` before mount wins; before mount it only picks the landing route, so the page still
records exactly one first view.

### What `track` accepts

- `name` matches `^[a-z][a-z0-9_.:-]{0,63}$` and is not reserved (`web.vital`, `js.error`, `page.engaged`).
- `props` is a plain object: nesting depth 4 **counting the root object** (the root plus at most three
  nested levels of objects or arrays; `{a:{b:{c:{d:1}}}}` passes, one more level fails), 32 keys per
  object and 32 items per array, keys `^[A-Za-z0-9_.-]{1,48}$`, strings up to 256 characters, finite
  numbers, at most 2,048 bytes serialized. Anything else drops the event.
- Before validation the SDK removes personal and identifier keys (after lower-casing and removing
  `_ - .`: email, password, phone, token, secret, apikey, ip, ipaddress, ipaddr, clientip, remoteaddr,
  address, postcode, ssn, iban, card number, cvv, date of birth, first/last/full/real/given/sur name,
  username, nickname, display name, player, player name, user, userid, uid, handle, url, href, and their
  variants) and scrubs every string value: e-mail-looking text becomes `[email]`, a `scheme://…` URL is cut
  to its host (`https://x.test/private/path?q=1` becomes `x.test`, credentials and port dropped), and
  IPv4- or IPv6-looking text becomes `[ip]` (IPv6 needs `::` or five or more groups, so clock times survive).
  The server repeats the key removal and e-mail masking.
  Known over-masking: the IP patterns are deliberately broad, so version-like dotted quads (`1.2.3.4`) and
  some hex-with-colons text also become `[ip]`. Strings over 256 characters skip scrubbing and fail validation.

**Host rule: props never carry user-entered free text or identity.** No names, handles, player names, typed
answers, search text, document text, file names or export contents. Send ids from the product's own closed
set (a puzzle id, a step name), counts, durations and flags. The key filter is a safety net, not
permission.

## Consent categories

| Category | Sends | Default outside the EEA | Default in the EEA or unknown |
|---|---|---|---|
| Usage counts | `POST /v1/collect-stat/<id>` contract v3 | on | on |
| Diagnostics | `web.vital`, `js.error`, `page.engaged` through `POST /v1/product/<id>` | on | off until OK |
| Journeys and product data | per-tab session id, `page.view` and `track` events through `POST /v1/product/<id>` | on | off until OK |

- The region comes from `GET /v1/consent/<id>`, cached in `sessionStorage` (`pulseboard:region:<id>`).
  Until it answers, and whenever it fails, times out (5 s) or is malformed, the visitor is treated as EEA
  and nothing is cached. While it is pending (no cached region, no recorded choice, no privacy signal),
  `track` events and error reports are held in memory, sharing the 100-item queue cap, so `track` returns
  `true`. When it answers they are sent if their category is on for that region or for the choice the
  visitor recorded meanwhile, and dropped otherwise; a failed hint counts as EEA and drops them.
- Global Privacy Control or Do Not Track turns every category off, silently: no bar, no request of any
  kind, and the pill's switches are disabled with a one-line explanation. Nothing is written while the signal
  is on: Turn all off or `consent.set` apply to the page only, and an earlier stored choice is left intact.
- The choice is stored in `localStorage` as `pulseboard:consent:v3:<id>` =
  `{counts, diagnostics, journeys, decided, month}` (month of the decision, UTC). A corrupt record counts as
  all-off and shows the bar again. If storage refuses the write, the choice holds for this page only.
  A choice recorded in another tab (the `storage` event on this key) is applied to every open tab at once,
  with the same clearing, dropping and aborting as below. Clearing storage or removing the key in another tab is not a choice: each
  open tab keeps the decision it already had and never falls back to the region defaults.
- Turning a category off clears its keys (counts: the visit marker `pulseboard:visit:<id>` in both
  storages; journeys: `pulseboard:session:<id>`), drops its queued items and aborts its in-flight requests (any product request
  carrying a session id counts as Journeys).

### The bar and the pill

At mount the bar is inserted as the first child of `<body>`: a `role="region"` line reading "**Beta** —
thanks for helping test <label>. We collect usage and diagnostics to improve it; no names, emails or IPs."
with **Choose** and **OK** buttons. OK records every category on. Choose opens three labelled switches in
place, each with a one-line description, plus **Save** and **Turn all off**. Once a choice is recorded the
bar is replaced by a small **Beta** button fixed bottom-left (or rendered inside an element carrying
`data-pulseboard-slot`) that reopens the switches; Escape closes them and returns focus to the pill.
Only a direct action in this tab's notice moves focus (OK, Save, Turn all off, the pill, Escape). A
choice recorded in another tab, or a host's `consent.set` call, updates the bar and switches without
taking focus from whatever the visitor is typing in. If keyboard focus was inside the notice being removed,
it moves to the pill rather than dropping to the page. A marked scroll pane that does not actually scroll
is ignored in favour of the window. All
controls are native buttons and checkboxes with visible focus, and nothing animates.

To avoid a layout shift when the deferred script inserts the bar, a host may reserve its space:

```html
<div data-pulseboard-bar style="min-height: 2.5rem"></div>   <!-- or a class in the host stylesheet -->
```

When `[data-pulseboard-bar]` exists the bar is rendered into it instead of being prepended to `<body>`.
Whenever no bar is showing (a choice was recorded, a privacy signal is on, the page is not eligible, or the
bar has just collapsed after OK, Save or Turn all off) the SDK releases the placeholder: it sets its height
and min-height to `0` and adds the `hidden` attribute. The placeholder is never removed from the DOM.
While the bar shows, the SDK sets the placeholder's `height` to `auto`, so a bar that wraps onto several lines on a
narrow screen pushes the page down instead of overlapping it. Use `min-height`, not `height`, for the reservation. A host with a
`position: fixed` header must use the placeholder (inside or below the header's flow): without it the bar is
prepended to `body` in normal flow and a fixed header can cover it.

## What is sent

Counts (`v: 3`): `{ v, context: { device, source, visit, scheme, referrer, campaign }, counts: [{ event, route, release, n: 1 }] }`.

- `device` from the viewport width: under 768 `mobile`, under 1024 `tablet`, else `desktop`.
- `referrer` is the referrer's registrable platform domain from a fixed allowlist, or `other`; `none` for
  direct or internal. A host can carry a person's name (`jane.github.io`, `janedoe.com`), so no other host
  is ever sent. Subdomains collapse to the platform (`news.google.co.uk` → `google.com`, `t.co` and
  `twitter.com` → `x.com`, `lnkd.in` → `linkedin.com`, `gist.github.com` → `github.com`, `*.github.io` →
  `github.io`, `janeco.slack.com` → `slack.com`). The list: google.com, bing.com, duckduckgo.com, yahoo.com, ecosia.org, brave.com, yandex.com, baidu.com, x.com, facebook.com, instagram.com, linkedin.com, reddit.com, news.ycombinator.com, lobste.rs, mastodon.social, bsky.app, youtube.com, tiktok.com, discord.com, slack.com, medium.com, dev.to, producthunt.com, github.com, github.io, gitlab.com, stackoverflow.com.
  It lives in `sdk/referrers.mjs`, which the builder inlines and the collector imports, and the collector
  stores `other` for any off-list value, so the two cannot drift. Never a path or query.
- `source` follows the same list: `search` (the eight search engines), `github` (github.com, github.io),
  `social` (the other platforms except gitlab.com and stackoverflow.com, which are `other`), `direct`,
  `internal` (same origin), else `other`.
- `campaign` is `utm_campaign` lowercased, sent only when the project registered that tag; `none` when absent,
  `other` otherwise. A free-form tag can carry a name (`?utm_campaign=alice_smith`), so nothing unregistered is
  counted. **To count a campaign, add its tag to the project's `campaigns` in `src/projects.mjs`** and rebuild
  the artifact; the builder embeds the list, and the collector checks the same registry, so a tag sent by an
  older build is stored as `other` until it is registered.
- `scheme` is `prefers-color-scheme` (`light` or `dark`).
- `visit` is `new` or `returning`: `returning` when the marker holds this or one of the previous twelve UTC
  months. The marker is one `localStorage` key holding only a month, plus a `sessionStorage` copy of the
  answer. **In the EEA (or before the region is known) no marker is read or written until the visitor
  clicks OK or records a choice with counts on; until then every batch says `new`.**

Product events (`v: 1`): `{ v, session, release, context: { device }, events: [{ name, route, seq, ms, props }] }`.

- `session` is a random UUID v4 kept in `sessionStorage` for one tab only while Journeys is on; otherwise
  `null`. The stored record is `{id, seq, started, last}`; a new id starts after 30 minutes without an event
  or 24 hours in total, including in a restored tab. A batch never mixes sessions. `seq` continues across
  the pages of that tab session (per page without Journeys); `ms` is time since the page loaded. When
  Journeys turns on after the page loaded (the region hint answers `other`, or the visitor clicks OK), the
  current route's `page.view` is sent to Journeys once.
- `web.vital` `{ metric, value, rating }` once per page per metric: FCP and TTFB as soon as known, LCP, CLS
  and INP on the first hide. Ratings use the web.dev thresholds. **INP is an approximation**: the longest
  Event Timing duration of any interaction, not the high-percentile INP definition.
- `js.error` `{ kind, message, source, line }`, at most 10 per page (counting only errors queued for
  sending; ones held before the region hint and then dropped do not use up the cap). The message is at most 160 characters
  with e-mail addresses, URLs and digit runs of six or more masked; `source` is the script's file name only
  (`inline` for the page itself, `other` when it is not a `.js` file). Resource load failures are ignored.
- `page.engaged` `{ seconds, scroll }` once, on the first time the page is hidden: visible seconds (at most
  3,600) and the deepest scroll percentage. An app that scrolls inside a pane rather than the window (an
  editor shell, for example) marks that element, and the depth is measured on it instead:

  ```html
  <main data-pulseboard-scroll>…</main>
  ```

  Without the attribute the window is measured; a full-height app shell would otherwise read about 100%.

Never sent: IP (the server sees it but stores none), user agent (classified server-side, never stored),
page URL or path, referrer path or query, cookies, or any identifier other than the per-tab session UUID.

## Transport limits

One queue per endpoint; a batch leaves at 20 items or after 2 seconds, capped at 16 KiB for product
batches. Requests use `fetch` with `mode: 'cors'`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`,
`Content-Type: application/json`, an `AbortController` and a 10-second timeout. `keepalive` is used while the
page's in-flight keepalive bytes stay within 64 KiB; when the page hides, only keepalive requests are made
and the rest is dropped with the page. Per page: at most 100 queued items and 120 requests. An endpoint that
fails three times (an error status or a network error; a timeout is an unknown outcome and does not count) stops sending for the rest of the page. Nothing is persisted offline. A bfcache restore
keeps the instance; an ordinary exit disposes it but lets keepalive requests finish.

## How to test

- `cd observatory && npm test` runs `tests/sdk-*.test.mjs`: consent defaults (EEA, other, unknown, GPC,
  DNT), OK/Choose/Save/Turn all off, key clearing and queue dropping, exact body shapes, the
  referrer/campaign/device tables, visit markers, `track` bounds and key removal, diagnostics caps and
  masking, transport caps, circuit and keepalive budget, DOM construction without HTML parsing, and the
  builder (determinism, `node --check`, a vm run of the artifact, and install-target refusal).
- In a host: build the artifact, serve the page from its registered origin, and watch the Network panel.
  With GPC on (Brave, or Firefox's setting) no request is made. A fresh profile outside the EEA sends one
  `GET /v1/consent/<id>`, then counts and product batches; `Pulseboard.consent.set({counts:false,
  diagnostics:false, journeys:false})` clears the `pulseboard:*` keys except the recorded choice and the
  session's region hint.
- The collector must list the project in `COLLECT_STAT_PROJECTS` and `COLLECT_PRODUCT_PROJECTS` before
  anything is stored; until then requests are refused and the SDK stops after three failures per endpoint.
