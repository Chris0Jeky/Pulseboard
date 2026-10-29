# Dashboard revocation and close deadline

Deleting a dashboard still commits its database deletion and revokes all hub
membership before waiting on any network operation. Revoked sockets can no longer
receive later broadcasts or initial-state events.

The hub starts every close handshake concurrently and waits at most one second
for the whole dashboard (`CLOSE_TIMEOUT_SECONDS`), not one second per connection.
A failed or stalled handshake does not prevent another connection's close attempt
or keep the deleting HTTP request waiting indefinitely. Caller cancellation is
propagated after membership removal and cancellation of outstanding close tasks.
Transport exceptions are logged without their message or payload.

Pending close tasks are cancelled and retained only until they settle. The hub
does not await cancellation completion: a transport coroutine can suppress it.
Such a coroutine cannot regain revoked membership, but Python cannot forcibly
terminate it. This bounds the wait while the event loop remains responsive, not
physical transport shutdown, total connection count, or total memory. The database
operation has its existing semantics.

## Initial-state and live sends

Live broadcasts already give each dashboard's concurrent sends one five-second
wait (`SEND_TIMEOUT_SECONDS`). Registration and subscription refresh now apply the
same deadline once to their whole cached initial-state batch, including time queued
behind another send. Timeout or caller cancellation revokes that connection
before starting best-effort closure. Cancellation propagates to the caller; a
cancellation-resistant send is retained until it settles, without awaiting it.
An ordinary initial-send exception retains the existing behavior: log the error,
keep the connection and attempt the remaining cached feeds in their input order.

Initial batches and live messages share a per-connection send lock. The batch
serializes all its cached messages while holding that lock, before the first send
yields. A stalled send for feed A cannot therefore cause the batch to read a newer
cached B after B's live updates have already queued. Membership/subscription checks
run after lock acquisition. Other connections retain independent sends/deadlines.

Each publication receives an internal monotonic number; it is not added to the
wire format. A per-connection, per-feed watermark advances only after a successful
send. Delayed live updates already covered by a newer delivered snapshot or live
message are skipped. This also handles an initial batch queued behind an existing
send: a snapshot may include newer state before older live tasks acquire the lock.
Failed sends do not advance the watermark. Unsubscribing prunes that feed's delivery
metadata; disconnecting discards the connection's metadata and lock. Queued work
cannot use an old lock after that connection is registered again. These structures
track existing latest feeds and subscriptions; they do not bound total feed count.

This serializes hub sends on a connection. It does not promise exactly-once
delivery, ordering between different connections, physical termination of a
transport that resists cancellation, or a bound while the event loop is blocked.

Regression checks use the real DataHub with fault-injected socket transports:

```sh
cd legacy/backend
python -m pytest tests/unit/test_revocation_deadline.py tests/unit/test_hub.py tests/unit/test_hub_history_bound.py -q
python -m pytest tests/unit/test_hub_initial_state.py tests/unit/test_hub_send_stall.py tests/unit/test_hub_subscriptions.py -q
```

The pre-fix hub failed the cooperative stall, cancellation-resistant stall and
caller-cancellation cases. Existing production-wiring deletion tests remain a
separate full-backend CI gate. No collection, deployment, schema, or owner-policy
setting changes.

The initial-state regressions use only synthetic transports. Before the repair,
four registration/refresh cases exceeded the deadline (cooperative and resistant
sends), and both ordering cases delivered `[2, 1]` instead of `[1, 2]`. Additional
caller-cancellation cases check membership/lock revocation and cancellation
propagation. Full backend CI separately checks the production route wiring.

The multi-feed review regressions hold cached A while live B=1/B=2 queue, for both
registration and refresh (the fixture chooses a valid A-first traversal of the
unordered refresh feed set). They require cached B=0 before B=1/B=2. A separate
case queues the initial batch behind a live send and checks that newer cached B
cannot be followed by an older queued B. All use explicit task/event barriers and
synthetic transports, without real sockets, listeners or live feeds.

`tests/unit/test_hub_delivery_sequences.py` separately checks sequence retirement
on unsubscribe, individual unregister and dashboard disconnect, including cached
state delivery on re-subscription/registration and isolation of another dashboard.
A failed newer cached send must leave both older/newer queued live updates eligible:
the failed snapshot cannot advance the successful-delivery watermark.
