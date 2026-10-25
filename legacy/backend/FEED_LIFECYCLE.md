# Feed lifecycle ownership

The legacy workbench remains frozen for new features. This repair addresses the
failure/cancellation part of #75 without changing its HTTP API or database schema.

A managed feed remains in `FeedManager.feeds` while `stop()` is pending. If that
coroutine raises, including a propagated cancellation, the instance remains
owned and its last-known hub data is retained. A later `stop_feed(id)` can retry
cleanup. Successful cleanup removes the entry and clears its hub data before
releasing the existing per-feed lifecycle lock.

A false `is_running()` flag is not evidence that plugin cleanup completed. When
`start_feed()` finds an inactive managed instance, it finishes that instance's
cleanup under the same lock before constructing its replacement. Failed or
cancelled cleanup cannot authorize a replacement. An already-running instance
still makes `start_feed()` a no-op; use explicit stop/restart to retry its cleanup.
Operations on other feed IDs use different locks and can progress independently.

`get_feed()` and the existing `get_running_feed_ids()` method expose managed
ownership, including pending cleanup. Call `is_feed_running()` for the plugin's
running state; ownership is not a healthy/running claim. Retained hub data is
last-known evidence, not a new successful sample.

This is an in-process, one-event-loop guarantee. No detached cleanup task, retry
loop, new timeout, background work, admission rule or network access is added.
Plugins must make `stop()` safe to retry after interruption, propagate errors
truthfully, and only return successfully when their resources are released.
The manager cannot force an arbitrary plugin to terminate, recover partial
startup resources, or detect a plugin that suppresses cancellation and falsely
reports success. Global shutdown coordination and cross-process ownership remain
separate work, as does the backend's local-only exposure/authentication boundary.

Stored `config_json` must decode to an object before the manager constructs or
starts a feed (#253). Start and restart raise `ValueError` for non-object JSON;
bulk loading logs the rejected row and continues with the other enabled feeds.
Rejected rows are left unchanged in the database for explicit repair.

## Bulk shutdown failures

`stop_all_feeds()` snapshots the currently managed IDs and tries their cleanup
sequentially through the same per-feed locks. One ordinary `Exception` does not
prevent attempts for later IDs. When the snapshot is exhausted, failures are
raised together as an `ExceptionGroup`, retaining the original exceptions in
attempt order, even when only one failed. No successful-shutdown message is
logged on that path. Failed instances and their last-known data stay owned for a
subsequent explicit retry; successful instances have already been removed.

Successful and empty calls still return `None`. The internal failure type is now
`ExceptionGroup`, rather than the first plugin exception; individual `stop_feed`
and restart calls are unchanged. The application lifespan propagates this group
rather than certifying successful shutdown. Python 3.11+ is already required.

`CancelledError` and other `BaseException` signals are not collected as ordinary
cleanup errors. Propagated caller cancellation interrupts the sweep and leaves
uncompleted instances owned for an explicit later attempt. Previously collected
errors do not turn cancellation into a successful return.

Shutdown is also an admission fence (#249): `stop_all_feeds` sets a
`_shutting_down` flag, waits for every in-flight start, restart or stop to release
its lifecycle lock, and only then takes its snapshot. Later starts and restarts are
refused with a warning, and the flag is never reset, so a manager is not reused
after shutdown. A plugin that never settles can still block the sweep (now before
any feed is stopped), and there is no automatic retry or forced termination.

Broadcast sends are bounded separately: the hub gives each socket send
`SEND_TIMEOUT_SECONDS` (5 s), then cancels it, unregisters the socket and closes it
best-effort in the background, so one stalled client cannot block other clients
or the publishing feed.

## Verification

From `legacy/backend/` with the existing requirements installed:

```sh
python -m pytest -q -p no:cacheprovider tests/unit/test_feed_stop_ownership.py tests/unit/test_feed_stop_all_failures.py
python -m pytest -q -p no:cacheprovider
python -m ruff check app
python -m mypy app
```

The six regressions use the real manager and hub with a controlled plugin and
explicit event gates. They cover pending, failed and cancelled cleanup, inactive
replacement, a queued start after cancellation, and independent-feed progress.
They do not certify every third-party plugin or a hosted deployment.

Eight bulk-shutdown cases additionally cover failure positions, multiple errors,
retry of retained instances, caller cancellation, empty input and normal success.
