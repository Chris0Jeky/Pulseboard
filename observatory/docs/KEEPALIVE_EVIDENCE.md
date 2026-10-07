# Legacy embed keepalive evidence (#122)

Run from `observatory/` with Node 22.16+, OpenSSL and Playwright 1.57 Chromium:

```sh
python tests/keepalive-http-test.py
python tests/sdk-keepalive-browser.py
```

The gate uses the actual generated legacy MDviewer embed, not SDK v3. Intercepted
requests prove that Playwright saw the submission; only the two loopback HTTPS
cases prove that the synthetic collector received bytes over a socket. No live
product or production collector is contacted. The endpoint/origin override is
in-memory in the test builder, not a registry or host artifact change.

Each SDK case opts in, waits for the first batch's successful settlement, clicks
a navigation link, and requires exactly `export.print_requested` in the received
batch within five seconds, with no cookie or referrer and the expected Origin.
This tests a queued pagehide batch, not interruption of an unfinished first send.

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

`--transport` selects `intercepted`, `http-cold`, `http-max-age-600`, or
`cache-control`. `--chromium` selects an existing browser. Every case uses a new
browser; HTTPS certificates and listeners are temporary and loopback-only.
Collector receipt and network traces are bounded. Browser request-failed events
may still accompany a socket-confirmed delivery during navigation; the receipt
is the delivery evidence, not a browser event alone.

Passing this gate does not identify the historical intermittent failure's root
cause, prove delivery after a browser crash, or certify current production hosts.
#122 remains open until the missing-event failure is reproduced and attributed,
or the final legacy host is verified retired. No blind retry, enlarged deadline,
production behavior change or relaxed event-delivery assertion is used here.
