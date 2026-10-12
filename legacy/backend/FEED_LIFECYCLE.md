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

This is a finite snapshot, not a shutdown admission fence. Concurrent new starts
are not prohibited, a plugin that never settles can still block later attempts,
and there is no automatic retry, detached task, forced termination or new timeout.
The existing success log applies to this completed sweep, not to concurrent new
work. Whole-application shutdown coordination remains separate work under #75.

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
