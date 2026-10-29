"""Initial snapshots share the live send deadline and per-socket ordering."""

import asyncio
import json
from uuid import uuid4

import pytest
from app.hub import hub as hub_module
from app.hub.hub import DataHub


class HeldFirstSend:
    """Synthetic transport: hold the first send, optionally resisting cancellation."""

    def __init__(self, resist_cancel=False):
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.resist_cancel = resist_cancel
        self.calls = 0
        self.values = []
        self.closed = False

    async def send_text(self, message):
        self.calls += 1
        if self.calls == 1:
            self.started.set()
            while not self.release.is_set():
                try:
                    await self.release.wait()
                except asyncio.CancelledError:
                    if not self.resist_cancel:
                        raise
        self.values.append(json.loads(message)["payload"]["value"])

    async def close(self, code=1000):
        self.closed = True


async def initial_operation(hub, dashboard, websocket, feed, refresh):
    if refresh:
        await hub.register_connection(dashboard, websocket, set())
        return asyncio.create_task(
            hub.refresh_dashboard_feeds(dashboard, websocket, {feed})
        )
    return asyncio.create_task(hub.register_connection(dashboard, websocket, {feed}))


@pytest.mark.parametrize("refresh", [False, True], ids=["register", "refresh"])
@pytest.mark.parametrize("resist_cancel", [False, True], ids=["cooperative", "resistant"])
async def test_initial_state_deadline_revokes_stalled_connection(
    monkeypatch, refresh, resist_cancel
):
    monkeypatch.setattr(hub_module, "SEND_TIMEOUT_SECONDS", 0.02)
    hub = DataHub()
    dashboard, feed = uuid4(), uuid4()
    await hub.publish_feed_event(feed, {"value": 1})
    websocket = HeldFirstSend(resist_cancel)
    operation = await initial_operation(hub, dashboard, websocket, feed, refresh)
    try:
        await asyncio.wait_for(websocket.started.wait(), 1)
        done, _ = await asyncio.wait({operation}, timeout=0.2)
        assert operation in done, "initial-state send exceeded its bounded deadline"
        operation.result()
        assert websocket not in hub.connections.get(dashboard, [])
        assert websocket not in hub._connection_feeds
        assert feed not in hub.dashboard_feeds.get(dashboard, set())
        await asyncio.sleep(0)
        assert websocket.closed
        calls = websocket.calls
        await hub.publish_feed_event(feed, {"value": 2})
        assert websocket.calls == calls, "revoked socket received another event"
    finally:
        websocket.release.set()
        await asyncio.wait_for(operation, 1)
        if hub._closing_tasks:
            await asyncio.wait_for(asyncio.gather(*hub._closing_tasks), 1)


@pytest.mark.parametrize("refresh", [False, True], ids=["register", "refresh"])
async def test_multi_feed_initial_snapshot_precedes_queued_live_updates(monkeypatch, refresh):
    hub = DataHub()
    dashboard, first_feed, second_feed = uuid4(), uuid4(), uuid4()
    await hub.publish_feed_event(first_feed, {"value": 100})
    await hub.publish_feed_event(second_feed, {"value": 0})
    websocket = HeldFirstSend()
    live_attempted = {value: asyncio.Event() for value in (1, 2)}
    send_one = hub._send_one

    async def observe_live(*args, **kwargs):
        live_attempted[json.loads(args[2])["payload"]["value"]].set()
        return await send_one(*args, **kwargs)

    monkeypatch.setattr(hub, "_send_one", observe_live)
    if refresh:
        await hub.register_connection(dashboard, websocket, set())
        initial = hub.refresh_dashboard_feeds(dashboard, websocket, [first_feed, second_feed])
    else:
        initial = hub.register_connection(dashboard, websocket, [first_feed, second_feed])
    tasks = [asyncio.create_task(initial)]
    try:
        await asyncio.wait_for(websocket.started.wait(), 1)
        # Both live sends have reached the lock before the first cached send finishes.
        for value in (1, 2):
            tasks.append(asyncio.create_task(hub.publish_feed_event(second_feed, {"value": value})))
            await asyncio.wait_for(live_attempted[value].wait(), 1)
        websocket.release.set()
        await asyncio.wait_for(asyncio.gather(*tasks), 1)
        assert websocket.values == [100, 0, 1, 2]
    finally:
        websocket.release.set()
        await asyncio.wait_for(asyncio.gather(*tasks), 1)


async def test_initial_snapshot_queued_behind_live_send_cannot_regress_feed(monkeypatch):
    hub = DataHub()
    dashboard, first_feed, second_feed = uuid4(), uuid4(), uuid4()
    await hub.publish_feed_event(second_feed, {"value": 0})
    websocket = HeldFirstSend()
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
            hub.refresh_dashboard_feeds(dashboard, websocket, [first_feed, second_feed])
        ))
        await asyncio.wait_for(batch_attempted.wait(), 1)
        for value in (1, 2):
            tasks.append(asyncio.create_task(hub.publish_feed_event(second_feed, {"value": value})))
            await asyncio.wait_for(live_attempted[value].wait(), 1)
        websocket.release.set()
        await asyncio.wait_for(asyncio.gather(*tasks), 1)
        assert websocket.values[0] == 100
        second_values = websocket.values[1:]
        assert second_values[-1] == 2
        assert second_values == sorted(second_values), "older live value followed newer cached state"
    finally:
        websocket.release.set()
        await asyncio.wait_for(asyncio.gather(*tasks), 1)


@pytest.mark.parametrize("refresh", [False, True], ids=["register", "refresh"])
async def test_cached_initial_value_cannot_arrive_after_new_live_value(monkeypatch, refresh):
    hub = DataHub()
    dashboard, feed = uuid4(), uuid4()
    await hub.publish_feed_event(feed, {"value": 1})
    websocket = HeldFirstSend()
    live_attempted = asyncio.Event()
    send_one = hub._send_one

    async def observe_live(*args, **kwargs):
        live_attempted.set()
        return await send_one(*args, **kwargs)

    monkeypatch.setattr(hub, "_send_one", observe_live)
    operation = await initial_operation(hub, dashboard, websocket, feed, refresh)
    publisher = None
    try:
        await asyncio.wait_for(websocket.started.wait(), 1)
        publisher = asyncio.create_task(hub.publish_feed_event(feed, {"value": 2}))
        await asyncio.wait_for(live_attempted.wait(), 1)
        websocket.release.set()
        await asyncio.wait_for(asyncio.gather(operation, publisher), 1)
        assert websocket.values == [1, 2]
    finally:
        websocket.release.set()
        tasks = [operation] + ([publisher] if publisher is not None else [])
        await asyncio.wait_for(asyncio.gather(*tasks), 1)


@pytest.mark.parametrize("resist_cancel", [False, True], ids=["cooperative", "resistant"])
async def test_cancelled_initial_state_revokes_membership_and_cancels_send(resist_cancel):
    hub = DataHub()
    dashboard, feed = uuid4(), uuid4()
    await hub.publish_feed_event(feed, {"value": 1})
    websocket = HeldFirstSend(resist_cancel)
    operation = await initial_operation(hub, dashboard, websocket, feed, False)
    try:
        await asyncio.wait_for(websocket.started.wait(), 1)
        operation.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(operation, 1)
        assert websocket not in hub.connections.get(dashboard, [])
        assert websocket not in hub._connection_feeds
        assert websocket not in hub._send_locks
        await asyncio.sleep(0)
        assert websocket.closed
    finally:
        websocket.release.set()
        await asyncio.gather(operation, return_exceptions=True)
        if hub._closing_tasks:
            await asyncio.wait_for(asyncio.gather(*hub._closing_tasks), 1)
