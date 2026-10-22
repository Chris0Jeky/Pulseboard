"""Deletion revokes hub membership before any awaited socket cleanup."""

import asyncio
from unittest.mock import AsyncMock
from uuid import uuid4

from app.hub.hub import DataHub


class Socket:
    def __init__(self):
        self.send_text = AsyncMock()
        self.close = AsyncMock()


async def test_dashboard_revocation_cleans_all_sockets_and_preserves_other_dashboard():
    hub = DataHub()
    deleted, other, feed = uuid4(), uuid4(), uuid4()
    first, second, healthy = Socket(), Socket(), Socket()
    first.close.side_effect = RuntimeError("already closed")
    for dashboard, socket in [(deleted, first), (deleted, second), (other, healthy)]:
        await hub.register_connection(dashboard, socket, {feed})
    await hub.disconnect_dashboard(deleted)
    assert deleted not in hub.connections
    assert deleted not in hub.dashboard_feeds
    first.close.assert_awaited_once_with(code=1008)
    second.close.assert_awaited_once_with(code=1008)
    await hub.publish_feed_event(feed, {"value": 1})
    first.send_text.assert_not_awaited()
    second.send_text.assert_not_awaited()
    healthy.send_text.assert_awaited_once()
    await hub.disconnect_dashboard(deleted)
    await hub.unregister_connection(deleted, second)
    assert deleted not in hub.connections


async def test_deletion_during_broadcast_sends_nothing_after_revocation():
    hub = DataHub()
    deleted, other, feed = uuid4(), uuid4(), uuid4()
    first, second, healthy = Socket(), Socket(), Socket()
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked_send(_message):
        entered.set()
        await release.wait()

    first.send_text.side_effect = blocked_send
    for dashboard, socket in [(deleted, first), (deleted, second), (other, healthy)]:
        await hub.register_connection(dashboard, socket, {feed})
    publishing = asyncio.create_task(hub.publish_feed_event(feed, {"value": 1}))
    try:
        await asyncio.wait_for(entered.wait(), timeout=2)
        # Sends are concurrent: the sibling and other dashboard are already served
        # while the first socket is still blocked.
        second.send_text.assert_awaited_once()
        healthy.send_text.assert_awaited_once()
        await hub.disconnect_dashboard(deleted)
    finally:
        release.set()
        await publishing
    # The revoked sockets receive nothing further and the later publish skips them.
    await hub.publish_feed_event(feed, {"value": 2})
    second.send_text.assert_awaited_once()
    assert healthy.send_text.await_count == 2


async def test_deletion_during_initial_state_stops_remaining_cached_events():
    hub = DataHub()
    dashboard, first_feed, second_feed = uuid4(), uuid4(), uuid4()
    await hub.publish_feed_event(first_feed, {"value": 1})
    await hub.publish_feed_event(second_feed, {"value": 2})
    socket = Socket()

    async def delete_on_first_send(_message):
        await hub.disconnect_dashboard(dashboard)

    socket.send_text.side_effect = delete_on_first_send
    await hub.register_connection(dashboard, socket, [first_feed, second_feed])
    socket.send_text.assert_awaited_once()
    assert dashboard not in hub.connections
