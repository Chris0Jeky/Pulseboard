"""A failed or cancelled plugin stop must not orphan its still-owned resources."""
import asyncio

import pytest

from app.feeds import manager as manager_module
from app.feeds.manager import FeedManager
from app.hub.hub import DataHub
from app.models import FeedDefinition


@pytest.fixture
def lifecycle(monkeypatch):
    created = []

    class ControlledFeed:
        def __init__(self, feed_id, config, hub):
            self.feed_id = feed_id
            self.running = False
            self.resource_open = False
            self.stop_entered = asyncio.Event()
            self.stop_release = asyncio.Event()
            self.stop_release.set()
            self.stop_error = None
            self.stop_count = 0
            created.append(self)

        async def start(self):
            self.running = True
            self.resource_open = True

        async def stop(self):
            self.stop_count += 1
            # A false running flag does not certify completion of plugin cleanup.
            self.running = False
            self.stop_entered.set()
            await self.stop_release.wait()
            if self.stop_error is not None:
                raise self.stop_error
            self.resource_open = False

        def is_running(self):
            return self.running

    monkeypatch.setattr(manager_module, "get_feed_class", lambda _: ControlledFeed)
    return FeedManager(DataHub()), FeedDefinition(type="controlled", name="one"), created


async def test_pending_stop_keeps_ownership_and_history(lifecycle):
    manager, definition, _ = lifecycle
    await manager.start_feed(definition)
    old = manager.get_feed(definition.id)
    await manager.hub.publish_feed_event(definition.id, {"value": 1})
    old.stop_release.clear()
    stopping = asyncio.create_task(manager.stop_feed(definition.id))
    try:
        await asyncio.wait_for(old.stop_entered.wait(), 1)
        assert manager.get_feed(definition.id) is old
        assert manager.get_running_feed_ids() == [definition.id]
        assert not manager.is_feed_running(definition.id)
        assert manager.hub.get_latest(definition.id) is not None
    finally:
        old.stop_release.set()
        await stopping
    assert not old.resource_open
    assert manager.get_feed(definition.id) is None
    assert manager.hub.get_history(definition.id) == []


async def test_failed_stop_keeps_ownership_until_successful_retry(lifecycle):
    manager, definition, _ = lifecycle
    await manager.start_feed(definition)
    old = manager.get_feed(definition.id)
    await manager.hub.publish_feed_event(definition.id, {"value": 1})
    latest = manager.hub.get_latest(definition.id)
    old.stop_error = RuntimeError("cleanup failed")
    with pytest.raises(RuntimeError, match="cleanup failed"):
        await manager.stop_feed(definition.id)
    assert manager.get_feed(definition.id) is old
    assert old.resource_open
    assert manager.hub.get_latest(definition.id) is latest
    old.stop_error = None
    await manager.stop_feed(definition.id)
    assert old.stop_count == 2
    assert not old.resource_open
    assert manager.get_feed(definition.id) is None
    assert manager.hub.get_latest(definition.id) is None


async def test_cancelled_active_stop_keeps_ownership_for_retry(lifecycle):
    manager, definition, _ = lifecycle
    await manager.start_feed(definition)
    old = manager.get_feed(definition.id)
    old.stop_release.clear()
    stopping = asyncio.create_task(manager.stop_feed(definition.id))
    try:
        await asyncio.wait_for(old.stop_entered.wait(), 1)
        stopping.cancel()
        with pytest.raises(asyncio.CancelledError):
            await stopping
        assert manager.get_feed(definition.id) is old
        assert old.resource_open
        assert not manager.is_feed_running(definition.id)
    finally:
        old.stop_release.set()
        await asyncio.gather(stopping, return_exceptions=True)
    await manager.stop_feed(definition.id)
    assert not old.resource_open
    assert old.stop_count == 2
    assert manager.get_feed(definition.id) is None


async def test_start_refuses_replacement_until_failed_cleanup_succeeds(lifecycle):
    manager, definition, created = lifecycle
    await manager.start_feed(definition)
    old = manager.get_feed(definition.id)
    old.stop_error = RuntimeError("cleanup failed")
    with pytest.raises(RuntimeError, match="cleanup failed"):
        await manager.stop_feed(definition.id)
    with pytest.raises(RuntimeError, match="cleanup failed"):
        await manager.start_feed(definition)
    assert manager.get_feed(definition.id) is old
    assert old.resource_open
    assert len(created) == 1
    old.stop_error = None
    await manager.start_feed(definition)
    assert not old.resource_open
    assert old.stop_count == 3
    assert manager.get_feed(definition.id) is created[1]
    assert created[1].resource_open


async def test_inactive_managed_feed_is_cleaned_before_replacement(lifecycle):
    manager, definition, created = lifecycle
    await manager.start_feed(definition)
    old = manager.get_feed(definition.id)
    old.running = False
    await manager.start_feed(definition)
    assert old.stop_count == 1
    assert not old.resource_open
    assert len(created) == 2
    assert manager.get_feed(definition.id) is created[1]


async def test_waiting_start_cannot_bypass_cancelled_stop_cleanup(lifecycle):
    manager, definition, created = lifecycle
    await manager.start_feed(definition)
    old = manager.get_feed(definition.id)
    old.stop_release.clear()
    stopping = asyncio.create_task(manager.stop_feed(definition.id))
    await asyncio.wait_for(old.stop_entered.wait(), 1)
    starting = asyncio.create_task(manager.start_feed(definition))
    try:
        await asyncio.sleep(0)
        assert not starting.done()
        stopping.cancel()
        with pytest.raises(asyncio.CancelledError):
            await stopping
        await asyncio.sleep(0)
        assert not starting.done(), "replacement bypassed interrupted cleanup"
        assert len(created) == 1
        assert manager.get_feed(definition.id) is old
        other = FeedDefinition(type="controlled", name="independent")
        await asyncio.wait_for(manager.start_feed(other), 1)
        assert manager.is_feed_running(other.id)
    finally:
        old.stop_release.set()
        await asyncio.gather(stopping, starting, return_exceptions=True)
    assert not old.resource_open
    assert old.stop_count == 2
    assert manager.get_feed(definition.id) is not old
