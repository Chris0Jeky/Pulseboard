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

Prepare a field note or a task handoff. Read the exact file, acknowledge the
sharing boundary, then download. No GitHub issue, Taskdeck card or agent action is
created automatically. An agent receiving a handoff must review scope, validate
its evidence against current state and propose work before applying anything.

## Keyboard and connection behaviour

`Ctrl/Cmd+K` opens the command palette. `1` through `4` switch views outside text
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
