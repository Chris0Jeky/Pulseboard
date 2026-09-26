# Desk guide

## A five-minute tour

Run `npm start` from `observatory/` on Node 22.16+. Nothing needs installing for the
Desk runtime. Open the printed local address and choose **Try a scenario**.

Start with **Release wobble**. Open Alibi, inspect its route receipts and separate
release cohorts, then open the Release lab. The failure fraction changed; the UI
will not call that causal. Switch the replay to Before or Recovery and watch the
invented incident change. **Missing readings** makes freshness the problem;
**Quiet portfolio** separates no usage evidence from failed availability;
**Event pressure** shows admission limits. Demo allowance values are invented
configuration, not the live registry's current limits.

The overview contains whole-portfolio KPIs. Search filters the project register
and signal views, not those portfolio totals. The project register can be sorted
by name, attention or admitted events. Small screens scroll the table internally.
The charts also expose their daily counts as an accessible table.

In the Signal inbox, open evidence before marking an observation reviewed.
Acknowledgements last seven days and snoozes one hour, on this browser only.
Changed evidence resurfaces because review keys include an evidence fingerprint.
This is not a shared incident-management system. Clear the site's local storage
to reset these preferences; neither tokens nor snapshots are stored there.

The **Usage** view (`5`) shows how a site is used: page views, starts,
completions, hints, errors, a day-by-day chart, route, event and release mixes, and
twelve separate dimensions (country, region, device, browser, operating system,
colour scheme, source, referrer host, new or returning, campaign, language and UTC
hour of receipt). Open-valued lists show their ten largest rows and fold the rest
into "All others" for display only; a literal `other` row is the collector's own
cap and is shown as it arrives. Usage and Product share a site picker and their own
window (24 hours, 7, 14, 30 or 90 days); the portfolio window is hidden there. The
view reads the aggregate statistics endpoint only while it is open, so the
30-second portfolio poll costs one extra read per refresh on this view and none
elsewhere. Its "questions worth asking" are leads computed from independent
counts, never per-player rates. Its coverage table shows, for every registered
site, what is measured today; a site marked "not measured" needs an owner decision
(notice review plus a host adapter), not a code change.

The **Product** view (`6`) reads `pulseboard.product/1` for the chosen site:
event names, events by day, the latest 100 journeys as step chips with their
durations, the last step before a session ended, web vitals as p75 per route with
web.dev colouring (INP is approximate in this SDK) and errors grouped by kind and
message. The **Explorer** reads raw events for one name only when you click
**Read events**: each property (nested keys dotted, array items as `key[]`) shows
how many events carry it, the top values for text and booleans, and min, median,
p90, max and a histogram for numbers. The newest 50 events are listed with their
properties as plain JSON text. A session is one browser tab, never a person.

A site with a **product panel** gets its own section above the explorer. Alibi's
reads the puzzle events on demand and shows, per puzzle, starts, completions,
failures, completions per start, solve time median and p90, and hint requests,
plus where people give up: a started puzzle with no completion in the same
session. To add a panel for another site, write `public/products/<id>.mjs`
exporting `{ title, names, compute(events), render(model, ui) }`: `names` are the
event names it reads, `compute` is a pure function over raw events (test it with
`node --test`), and `render` builds nodes only through the helpers in `ui`
(`e`, `table`, `panel`, `count`, `percent`), which write text, never markup.
Register it in `public/products/index.mjs`, list the file in `src/assets.mjs`, add
it to the module list in `tests/desk-browser.py`, and keep the asset budget test green.
Demo mode (`?demo=release` or **Try a scenario**) fills both views and the Alibi
panel with seeded synthetic data that never leaves the tab.

Prepare a field note or a task handoff. Read the exact file, acknowledge the
sharing boundary, then download. No GitHub issue, Taskdeck card or agent action is
created automatically. An agent receiving a handoff must review scope, validate
its evidence against current state and propose work before applying anything.

## Keyboard and connection behaviour

`Ctrl/Cmd+K` opens the command palette. `1` through `6` switch views outside text
inputs and dialogs. `/` focuses search. Escape closes the active native dialog.
The density button switches between comfortable and compact spacing.

**Connect data** reads the same origin's API. No arbitrary URL or proxy field is
accepted. The token is held in memory and the password input is cleared when
connection starts. Refresh occurs every 30 seconds, pauses in hidden tabs, and
has a ten-second timeout. A failed read preserves a stale last-good snapshot.
A 401, disconnect or pagehide clears the token, snapshot, imports and previews.
A delayed response cannot revive a disconnected session.

Local startup does not run external probes. Hosted cron deployment and collection
activation require the existing rollout checklist. Browser events are still
client-reported and opt-in; sessions are not unique people. Only attributed
release labels can be compared. The live registry initially allows `unattributed`;
add explicit release labels on both the collector and SDK side before expecting
real release comparisons.

## Tests

```bash
cd observatory
npm test
```

This includes the existing kit suite, 24 evidence-model/API tests and 14 bridge,
response-contract and asset-budget tests. The browser gate has one optional test
dependency, isolated from the runtime:

```bash
python -m venv .browser-venv
# Activate the venv using your shell's normal command.
python -m pip install playwright==1.57.0
python -m playwright install chromium
```

In one terminal, set `READ_TOKEN` to a test-only value of at least 32 characters and
run `npm start`. In the test terminal, set the same `READ_TOKEN` and run:

```bash
python tests/desk-browser.py --origin http://127.0.0.1:8788 --screenshots .data/screenshots
```

The gate first loads real HTTP assets and connects to the real local SQLite API.
It then injects deterministic response failures to exercise 503, malformed bodies,
401 and late-response races. It also checks previews, imports, keyboard actions,
replay and responsive widths. It does not generate real production traffic.

For an environment that blocks browser navigation to localhost:

```bash
python tests/desk-browser.py --offline
```

That mode inlines the same modules and styles. It checks rendering and interaction
but explicitly skips real serving, CSP and the initial real API connection.
`--chromium /path/to/chromium` selects an existing browser when needed. The GitHub
Desk browser workflow uses the real HTTP mode with collection disabled.

## Known limits

No hosted D1 deployment or production traffic is certified by the local tests.
Imports are manually reviewed, unverified files held in one tab. Project identities
from imported catalogues are not silently fuzzy-matched to telemetry projects.
There is no cross-tab incident sync, automatic retry backoff escalation, persistent
snapshot history, live trace viewer or named-action funnel in this version.
