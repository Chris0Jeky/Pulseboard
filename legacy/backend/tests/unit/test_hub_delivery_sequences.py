"""Delivery metadata must retire with subscriptions and advance only on success."""

import asyncio
import json
from uuid import uuid4

import pytest
from app.hub.hub import DataHub


class Transport:
    """Synthetic send/close transport with optional first-send and failure controls."""

    def __init__(self, *, hold_first=False, fail_once_value=None):
        self.hold_first = hold_first
        self.fail_once_value = fail_once_value
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.attempts = []
        self.failures = []
        self.values = []
        self.closed = False

    async def send_text(self, message):
        value = json.loads(message)["payload"]["value"]
        self.attempts.append(value)
        if self.hold_first and not self.started.is_set():
            self.started.set()
            await self.release.wait()
        if value == self.fail_once_value:
            self.fail_once_value = None
            self.failures.append(value)
            raise RuntimeError("synthetic send failure")
        self.values.append(value)

    async def close(self, code=1000):
        self.closed = True


async def test_unsubscribe_retires_only_removed_feed_and_resubscribe_sends_cached_state():
    hub = DataHub()
    dashboard, removed, retained = uuid4(), uuid4(), uuid4()
    await hub.publish_feed_event(removed, {"value": 1})
    await hub.publish_feed_event(retained, {"value": 10})
    websocket = Transport()
    await hub.register_connection(dashboard, websocket, {removed, retained})
    retained_sequence = hub._connection_sequences[websocket][retained]
    websocket.values.clear()

    await hub.refresh_dashboard_feeds(dashboard, websocket, {retained})
    assert hub._connection_sequences[websocket] == {retained: retained_sequence}

    # The same publication must be sent for a new subscription, rather than
    # suppressed by delivery metadata left over from its previous subscription.
    await hub.refresh_dashboard_feeds(dashboard, websocket, {removed, retained})
    assert websocket.values == [1]
    await hub.publish_feed_event(retained, {"value": 11})
    assert websocket.values == [1, 11]


@pytest.mark.parametrize("whole_dashboard", [False, True], ids=["unregister", "disconnect-dashboard"])
async def test_connection_retirement_discards_sequences_and_preserves_other_dashboard(whole_dashboard):
    hub = DataHub()
    dashboard, other_dashboard, feed = uuid4(), uuid4(), uuid4()
    await hub.publish_feed_event(feed, {"value": 1})
    websocket, other = Transport(), Transport()
    await hub.register_connection(dashboard, websocket, {feed})
    await hub.register_connection(other_dashboard, other, {feed})
    other_sequences = dict(hub._connection_sequences[other])

    if whole_dashboard:
        await hub.disconnect_dashboard(dashboard)
        assert websocket.closed
    else:
        await hub.unregister_connection(dashboard, websocket)
    assert websocket not in hub._connection_sequences
    assert websocket not in hub._connection_feeds
    assert websocket not in hub._send_locks
    assert websocket not in hub.connections.get(dashboard, [])
    assert hub._connection_sequences[other] == other_sequences
    assert not other.closed

    # Reuse the synthetic object to probe a new logical registration: its cached
    # publication must not be suppressed by the retired registration's watermark.
    await hub.register_connection(dashboard, websocket, {feed})
    assert websocket.values == [1, 1]
    await hub.publish_feed_event(feed, {"value": 2})
    assert websocket.values == [1, 1, 2]
    assert other.values == [1, 2]


async def test_failed_newer_cached_send_does_not_suppress_older_queued_live_update(monkeypatch):
    hub = DataHub()
    dashboard, first_feed, second_feed = uuid4(), uuid4(), uuid4()
    await hub.publish_feed_event(second_feed, {"value": 0})
    websocket = Transport(hold_first=True, fail_once_value=2)
    await hub.register_connection(dashboard, websocket, {first_feed})
    live_attempted = {value: asyncio.Event() for value in (1, 2)}
    batch_attempted = asyncio.Event()
    send_one, send_batch = hub._send_one, hub._send_initial_batch

    async def observe_live(*args, **kwargs):
        value = json.loads(args[2])["payload"]["value"]
        if value in live_attempted:
            live_attempted[value].set()
        return await send_one(*args, **kwargs)

    async def observe_batch(*args, **kwargs):
        batch_attempted.set()
        return await send_batch(*args, **kwargs)

    monkeypatch.setattr(hub, "_send_one", observe_live)
    monkeypatch.setattr(hub, "_send_initial_batch", observe_batch)
    tasks = [asyncio.create_task(hub.publish_feed_event(first_feed, {"value": 100}))]
    try:
        await asyncio.wait_for(websocket.started.wait(), 1)
        tasks.append(asyncio.create_task(
            hub.refresh_dashboard_feeds(dashboard, websocket, {first_feed, second_feed})
        ))
        await asyncio.wait_for(batch_attempted.wait(), 1)
        for value in (1, 2):
            tasks.append(asyncio.create_task(hub.publish_feed_event(second_feed, {"value": value})))
            await asyncio.wait_for(live_attempted[value].wait(), 1)
        websocket.release.set()
        await asyncio.wait_for(asyncio.gather(*tasks), 1)

        # The queued batch sees B=2 but its send fails. Advancing the watermark
        # before success would incorrectly drop the still-needed B=1 and B=2.
        assert websocket.attempts == [100, 2, 1, 2]
        assert websocket.failures == [2]
        assert websocket.values == [100, 1, 2]
        assert websocket in hub.connections[dashboard]
        assert not websocket.closed
    finally:
        websocket.release.set()
        await asyncio.wait_for(asyncio.gather(*tasks), 1)
