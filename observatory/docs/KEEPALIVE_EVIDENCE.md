# Legacy embed keepalive evidence (#122)

Run from `observatory/` with Node 22.16+, OpenSSL and Playwright 1.62 Chromium (pinned in #248; the receipts below record the 1.57 runs):

```sh
python tests/keepalive-http-test.py
python tests/sdk-keepalive-browser.py
```

The gate uses the actual generated legacy MDviewer embed, not SDK v3. Both
loopback HTTPS cases require the synthetic collector to receive bytes over a socket. No live
product or production collector is contacted. The endpoint/origin override is
in-memory in the test builder, not a registry or host artifact change.

Each SDK case opts in, waits for the first batch's successful settlement, clicks
a navigation link, and requires exactly `export.print_requested` in the received
batch within five seconds, with no cookie or referrer and the expected Origin.
This tests a queued pagehide batch, not interruption of an unfinished first send.

## Reproduced interception race (2026-10-16, #122)

Starting at `8f14259` in `pb-122`, the unchanged intercepted case failed **29/30**
independent runs using Python 3.14.3, Playwright 1.57.0, its bundled Chromium 143
headless shell and Node 24.13.1 on Windows. The assertion was exactly:

```text
AssertionError: timed out waiting for export.print_requested; received []
```

The initial page view arrived and settled. A diagnostic run confirmed that the
SDK had one queued event at pagehide and called fetch with `keepalive: true` and
the expected body. Chromium issued the unload preflight, then reported
`net::ERR_ABORTED` during document replacement. The routed collector never
received that POST. Waiting for the initial POST's `requestfinished` event did
not repair it (5/5 failures).

The discriminating control used the same real HTTPS fixture and unchanged SDK:
direct sockets passed 5/5; adding only a pass-through
`context.route(endpoint, lambda route: route.continue_())` reproduced the missing
event in 3/3 runs. This attributes the reproduced missing-event failure to
Chromium/Playwright interception during unload, rather than an SDK disposal or
queueing error. The precise upstream scheduling defect is not identified.
Playwright 1.57 also
[handles intercepted preflights internally](https://github.com/microsoft/playwright/blob/v1.57.0/packages/playwright-core/src/server/chromium/crNetworkManager.ts),
so the old route handler's OPTIONS branch was not a reliable preflight diagnostic.

The delivery gate now uses real sockets throughout; `--transport intercepted`
is removed. This replaces the unreliable delivery oracle, rather than retiring
the legacy SDK proof. Each HTTPS collector withholds the unload preflight
response until the replacement page's `#arrived` element is visibly present.
That observable navigation releases a threading event; no elapsed delay releases
the preflight. Missing navigation refuses the preflight with 504. The received
batch must still contain exactly the queued event within the original five-second
receipt deadline, with the original Origin, byte, cookie and referrer assertions.
Startup likewise waits for the mounted SDK instead of a 250 ms sleep.

A generated-script mutant replacing `keepalive: true` with `false` fails with
the same missing-event assertion against this delayed real preflight. This checks
that the replacement gate detects a real loss of unload delivery; an ordinary
fetch cannot satisfy it just by reaching the collector before navigation.
Production SDK sources and generated host artifacts are unchanged.

### Local verification receipts

At base `8f1425965168ca20617a3c644981d5127e308761`, with the uncommitted fix:

- **0/50 failures** in consecutive complete `sdk-keepalive-browser.py` processes:
  100 SDK unload deliveries (50 at each max-age), all exactly 194 bytes, and
  50 independent cache controls observing cumulative preflight counts 1, 1, 2, 3.
  Each run starts fresh browsers; no failed run is retried or discarded.
- `tests/keepalive-http-test.py`: **7/7 passed**, including blocked-preflight
  release and refusal. The no-keepalive mutant failed the exact delivery assertion.
- The real local-server browser suite passed: Desk **17 checks**, interactions,
  release fold, handoff, operations, Alibi journey and error coverage.
- `scripts/agent/check.ps1`: whitespace checks passed; Node tests had **811 passed,
  10 failed, 2 skipped**. An unchanged-HEAD snapshot retaining the checkout's line
  endings reproduced the same ten failure names: seven Windows symlink `EPERM`
  failures and three LF-only workflow parsing assertions against CRLF input.
  These are outside this fix. The harness audit also retained its pre-existing
  UNPROVEN server-rule bypass measurement; it is not a fully green gate.

Ignored local evidence remains under `.cache/`: `baseline-157/` (30 original
runs and exact failing assertions), `socket-157/`, `socket-intercept-157/`,
`diagnostic-157/`, `candidate-finished/`, `mutant.log`, `fixed-50/` (50 full logs
and `summary.json`), `baseline-suite.log`, `agent-check.log`, and
`related-*-browser.log`. The repetition driver was
`.browser-venv/Scripts/python.exe .cache/keepalive-runs.py fixed-50 50` from the
worktree root; it launches the default full test in a separate process each time.
OpenSSL was supplied on the child PATH from `C:/Program Files/Git/usr/bin`.
No CI, production delivery, crash delivery or legacy-host retirement was verified.
`HUMAN_TODO.md` is unchanged; this fix needs no owner action. No commit or push
was made, and the issue was not modified remotely.

## Correct the cache assumption, not the SDK

The first #203 browser run (37549211560, head `18e98b6`) delivered in all three
SDK cases, but failed an extra assertion expecting only one OPTIONS request with
`Access-Control-Max-Age: 600`. There were two. `src/browser.mjs` deliberately uses
`cache: 'no-store'`; Chromium's `PreflightController::PerformPreflightCheck` only
consults the preflight cache when its cache flags are absent. See the
[Chromium implementation](https://chromium.googlesource.com/chromium/src/+/main/services/network/cors/preflight_controller.cc).

Both real SDK cases now require two socket-observed preflights, with server
max-age 0 and 600 respectively. The separately labelled `cache-control` case
makes four ordinary synthetic fetches to the same fixture: two default-cache
requests share one preflight, then two no-store requests each add another.
That control tests browser caching, NOT SDK navigation delivery. It neither
modifies the SDK nor claims its normal requests use the cache.

`--transport` selects `http-cold`, `http-max-age-600`, or
`cache-control`. `--chromium` selects an existing browser. Every case uses a new
browser; HTTPS certificates and listeners are temporary and loopback-only.
Collector receipt and network traces are bounded. Browser request-failed events
may still accompany a socket-confirmed delivery during navigation; the receipt
is the delivery evidence, not a browser event alone.

The passing evidence through #207 did not establish the original failure's cause.
The investigation above attributes the locally reproduced failure to interception;
it does not prove every historical occurrence had that cause, delivery after a
browser crash, or the state of current production hosts. No blind retry, enlarged
deadline, production behavior change or relaxed event-delivery assertion is used.

## Certificate trust at the handshake (2026-10-16, host)

The receipt gate merged in #233 passed hosted Linux CI (Playwright 1.57) and 50/50
runs in the Codex sandbox, but failed on the Windows host DESKTOP-IHKOOJS with the
same missing-event assertion (10/10 reported, 6/6 reproduced here) under Python 3.14
and Playwright 1.62, whose headless Chromium is 151.0.7922.34. With Playwright 1.57
(Chromium 143.0.7499.4), the unchanged test passed 3/3 on the same host.

Both browsers drew one certificate alert from the collector for each TLS connection,
because Chromium rejects the self-signed handshake first and then retries under the
context's `ignore_https_errors` override. Under Chromium 143, the unload keepalive
request retried and arrived (four collector alerts). Under Chromium 151, it got the
alert and its preflight never reached the socket (three collector alerts). The exact
Chromium change was not traced. Launching the unchanged run with
`--ignore-certificate-errors` passed 3/3 under Chromium 151, which isolates
certificate trust as the cause.

The fixture now publishes its temporary key's SPKI hash, and both browser cases
launch Chromium with `--ignore-certificate-errors-spki-list=<hash>`, so the network
stack trusts only that key during the handshake. `ignore_https_errors` is gone,
and the delivery case asserts that neither fixture origin saw a TLS alert. The
`keepalive: false` mutant still fails on the exact missing-event assertion, with
the unload preflight reaching the socket after navigation and no POST following.

Host receipts, each a run of consecutive full `sdk-keepalive-browser.py` processes
with no failure and no TLS alert (two deliveries of exactly 194 bytes and one cache
control per run): 50/50 at `af01af9` and 50/50 again at `b48a816` under Playwright
1.62, and 10/10 at `af01af9` under Playwright 1.57. The mutant failed both SDK
cases under each version. `tests/keepalive-http-test.py` passed 20/20 complete
suites at `b48a816`. Hosted Linux CI (Playwright 1.57) passed at `b48a816`.

## TLS diagnostic follow-up

Temporary self-signed certificates produce server-side unknown-CA or
certificate-unknown alerts when a client does not trust them. On Windows, the
rejection test's server instead saw a `ConnectionResetError` before the handshake
completed in 8/30 host runs, consistent with the client's reset discarding its
unread alert. The helper records any reset before handshake completion as
`HANDSHAKE_RESET`, without inferring its cause; later resets keep their traceback.
The helper retains only these three known reasons and the fixture
role in a 64-entry deque, emitting one `fixtureRecentTlsAlerts` summary on exit.
It does not log client addresses, certificates, keys, headers or payloads there.
Unexpected SSL or non-SSL server failures still print their normal tracebacks.

A real verifying client rejects the certificate in the regression test; the
server must record that rejection without a traceback or collector receipt.
A subsequent fixture-authorized request must still reach the socket. This
changes diagnostics only, not production TLS policy, SDK behavior, timeouts,
preflight counts, or event-delivery assertions. A compact alert is not evidence
of a failed production request or successful delivery; the socket receipt remains
the delivery evidence.

## Early oversized-request rejection

The body-limit fixture sends an oversized Content-Length header without a body
and requires an immediate 413 with no receipt. A separate positive case sends
all 65,536 bytes at the inclusive limit and requires an identical stored body.
Uploading a refused 65,537-byte body can race the server's early connection close
and raise a client BrokenPipeError before its HTTP library reads the 413. The
header-only test removes that client race while strictly proving early rejection;
it does not accept a broken pipe as evidence or weaken the collector's bound.
