"""A stalled client send must not block healthy sockets or publishing."""

import asyncio
from uuid import uuid4

import pytest

from app.hub import hub as hub_module
from app.hub.hub import DataHub


class _Healthy:
    def __init__(self):
        self.messages = []

    async def send_text(self, message):
        self.messages.append(message)

    async def close(self, code=1000):
        pass


class _Stalled(_Healthy):
    """send_text never completes until released."""

    def __init__(self):
        super().__init__()
        self.release = asyncio.Event()
        self.closed_with = None

    async def send_text(self, message):
        await self.release.wait()

    async def close(self, code=1000):
        self.closed_with = code


def _wire(hub, feed_id, *sockets):
    dashboard_id = uuid4()
    hub.connections[dashboard_id].extend(sockets)
    hub.dashboard_feeds[dashboard_id].add(feed_id)
    return dashboard_id


async def test_stalled_send_does_not_block_healthy_sockets(monkeypatch):
    monkeypatch.setattr(hub_module, "SEND_TIMEOUT_SECONDS", 0.05)
    hub = DataHub()
    feed_id = uuid4()
    stalled, healthy = _Stalled(), _Healthy()
    dashboard_id = _wire(hub, feed_id, stalled, healthy)

    await asyncio.wait_for(hub.publish_feed_event(feed_id, {"v": 1}), timeout=1.0)

    assert len(healthy.messages) == 1
    assert stalled not in hub.connections[dashboard_id]
    assert healthy in hub.connections[dashboard_id]
    await asyncio.sleep(0)
    assert stalled.closed_with is not None

    # The next publish is not delayed by the removed socket.
    await asyncio.wait_for(hub.publish_feed_event(feed_id, {"v": 2}), timeout=1.0)
    assert len(healthy.messages) == 2


async def test_stalled_dashboard_does_not_block_other_dashboard(monkeypatch):
    monkeypatch.setattr(hub_module, "SEND_TIMEOUT_SECONDS", 0.05)
    hub = DataHub()
    feed_id = uuid4()
    stalled, healthy = _Stalled(), _Healthy()
    _wire(hub, feed_id, stalled)
    _wire(hub, feed_id, healthy)

    await asyncio.wait_for(hub.publish_feed_event(feed_id, {"v": 1}), timeout=1.0)

    assert len(healthy.messages) == 1


async def test_cancelled_publish_cancels_its_pending_sends():
    hub = DataHub()
    dashboard_id = uuid4()
    stalled = _Stalled()
    await hub.register_connection(dashboard_id, stalled, set())

    publisher = asyncio.create_task(hub._send_to_dashboard(dashboard_id, "m"))
    await asyncio.sleep(0.01)
    publisher.cancel()
    with pytest.raises(asyncio.CancelledError):
        await publisher
    await asyncio.sleep(0)

    current = asyncio.current_task()
    assert [t for t in asyncio.all_tasks() if t is not current] == []
