"""A failed close handshake must not hold dashboard deletion or other sockets hostage."""

import asyncio
from uuid import uuid4

import pytest

from app.hub import hub as hub_module
from app.hub.hub import DataHub


class Socket:
    def __init__(self, close_action=None):
        self.close_action = close_action
        self.closed = asyncio.Event()
        self.close_started = asyncio.Event()
        self.messages = []
        self.task = None

    async def send_text(self, message):
        self.messages.append(message)

    async def close(self, code):
        assert code == 1008
        self.task = asyncio.current_task()
        self.close_started.set()
        if self.close_action:
            await self.close_action()
        self.closed.set()


@pytest.mark.parametrize("resist_cancel", [False, True])
async def test_stalled_close_has_one_deadline_and_does_not_block_other_sockets(monkeypatch, resist_cancel):
    monkeypatch.setattr(hub_module, "CLOSE_TIMEOUT_SECONDS", 0.02, raising=False)
    hub = DataHub()
    dashboard, other, feed = uuid4(), uuid4(), uuid4()
    release, cancelled = asyncio.Event(), asyncio.Event()

    async def stalled():
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled.set()
            if not resist_cancel:
                raise
            await release.wait()

    slow, fast, healthy = Socket(stalled), Socket(), Socket()
    for target, socket in [(dashboard, slow), (dashboard, fast), (other, healthy)]:
        await hub.register_connection(target, socket, {feed})
    deleting = asyncio.create_task(hub.disconnect_dashboard(dashboard))
    try:
        await asyncio.wait_for(slow.close_started.wait(), 1)
        # Revocation happens first, even while a transport refuses to close.
        assert dashboard not in hub.connections
        assert dashboard not in hub.dashboard_feeds
        await hub.publish_feed_event(feed, {"value": 1})
        assert slow.messages == fast.messages == []
        assert len(healthy.messages) == 1
        done, _ = await asyncio.wait({deleting}, timeout=0.5)
        assert deleting in done, "one stalled close prevented bounded dashboard deletion"
        await deleting
        await asyncio.wait_for(cancelled.wait(), 1)
        assert fast.closed.is_set(), "a stalled first socket prevented another close attempt"
        assert not healthy.close_started.is_set()
        await hub.disconnect_dashboard(dashboard)  # repeated revocation is inert
    finally:
        release.set()
        await asyncio.wait_for(deleting, 1)
        for socket in (slow, fast):
            if socket.task and socket.task is not deleting:
                await asyncio.gather(socket.task, return_exceptions=True)


async def test_caller_cancellation_propagates_after_revocation_and_cancels_close_tasks(monkeypatch):
    monkeypatch.setattr(hub_module, "CLOSE_TIMEOUT_SECONDS", 60, raising=False)
    hub, dashboard = DataHub(), uuid4()
    release = asyncio.Event()
    first, second = Socket(release.wait), Socket(release.wait)
    await hub.register_connection(dashboard, first, set())
    await hub.register_connection(dashboard, second, set())
    deleting = asyncio.create_task(hub.disconnect_dashboard(dashboard))
    try:
        await asyncio.wait_for(first.close_started.wait(), 1)
        deleting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await deleting
        assert dashboard not in hub.connections
        assert dashboard not in hub.dashboard_feeds
        assert second.close_started.is_set(), "all close attempts should start together"
    finally:
        release.set()
        tasks = [s.task for s in (first, second) if s.task and s.task is not deleting]
        await asyncio.gather(*tasks, return_exceptions=True)
    assert all(task.done() for task in tasks)


async def test_close_exception_does_not_block_others_or_log_transport_content(caplog):
    hub, dashboard = DataHub(), uuid4()

    async def broken():
        raise RuntimeError("PRIVATE-TRANSPORT-DETAIL")

    first, second = Socket(broken), Socket()
    await hub.register_connection(dashboard, first, set())
    await hub.register_connection(dashboard, second, set())
    await hub.disconnect_dashboard(dashboard)
    assert second.closed.is_set()
    assert "PRIVATE-TRANSPORT-DETAIL" not in caplog.text
    assert dashboard not in hub.connections
