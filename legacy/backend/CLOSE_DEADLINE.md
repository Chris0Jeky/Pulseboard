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
physical transport shutdown, total connection count, or total memory. Normal
broadcast sends and the database operation have their existing semantics.

Regression checks use the real DataHub with fault-injected socket transports:

```sh
cd legacy/backend
python -m pytest tests/unit/test_revocation_deadline.py tests/unit/test_hub.py tests/unit/test_hub_history_bound.py -q
```

The pre-fix hub failed the cooperative stall, cancellation-resistant stall and
caller-cancellation cases. Existing production-wiring deletion tests remain a
separate full-backend CI gate. No collection, deployment, schema, or owner-policy
setting changes.
