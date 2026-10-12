"""One plugin cleanup error must not prevent attempts to stop the remaining feeds."""
import asyncio
import logging

import pytest

from app.feeds import manager as manager_module
from app.feeds.manager import FeedManager
from app.hub.hub import DataHub
from app.models import FeedDefinition


@pytest.fixture
def fleet(monkeypatch):
    created = []

    class ControlledFeed:
        def __init__(self, feed_id, config, hub):
            self.feed_id = feed_id
            self.running = False
            self.resource_open = False
            self.stops = 0
            self.error = None
            self.entered = asyncio.Event()
            self.release = asyncio.Event()
            self.release.set()
            created.append(self)

        async def start(self):
            self.running = True
            self.resource_open = True

        async def stop(self):
            self.stops += 1
            self.running = False
            self.entered.set()
            await self.release.wait()
            if self.error is not None:
                raise self.error
            self.resource_open = False

        def is_running(self):
            return self.running

    monkeypatch.setattr(manager_module, "get_feed_class", lambda _: ControlledFeed)
    return FeedManager(DataHub()), created


async def populate(manager, count=3):
    for n in range(count):
        definition = FeedDefinition(type="controlled", name=f"feed-{n}")
        await manager.start_feed(definition)
        await manager.hub.publish_feed_event(definition.id, {"value": n})


@pytest.mark.parametrize("failed", [(0,), (1,), (2,), (0, 2)])
async def test_bulk_stop_attempts_each_feed_and_reports_every_failure(fleet, failed, caplog):
    manager, created = fleet
    await populate(manager)
    for n in failed:
        created[n].error = RuntimeError(f"cleanup-{n}")
    raised = None
    with caplog.at_level(logging.INFO, logger="app.feeds.manager"):
        try:
            await manager.stop_all_feeds()
        except Exception as exc:
            raised = exc
    assert [feed.stops for feed in created] == [1, 1, 1]
    assert isinstance(raised, ExceptionGroup)
    assert raised.exceptions == tuple(created[n].error for n in failed)
    assert "All feeds stopped" not in caplog.text
    for n, feed in enumerate(created):
        assert feed.resource_open == (n in failed)
        assert (manager.get_feed(feed.feed_id) is feed) == (n in failed)
        assert (manager.hub.get_latest(feed.feed_id) is not None) == (n in failed)


async def test_bulk_stop_retry_only_revisits_retained_failed_instances(fleet):
    manager, created = fleet
    await populate(manager)
    created[0].error = RuntimeError("temporary cleanup failure")
    with pytest.raises(Exception):
        await manager.stop_all_feeds()
    assert manager.get_running_feed_ids() == [created[0].feed_id]
    created[0].error = None
    await manager.stop_all_feeds()
    assert [feed.stops for feed in created] == [2, 1, 1]
    assert not any(feed.resource_open for feed in created)
    assert manager.get_running_feed_ids() == []


async def test_bulk_stop_caller_cancellation_is_not_an_ordinary_cleanup_error(fleet):
    manager, created = fleet
    await populate(manager)
    created[0].release.clear()
    stopping = asyncio.create_task(manager.stop_all_feeds())
    try:
        await asyncio.wait_for(created[0].entered.wait(), 1)
        stopping.cancel()
        with pytest.raises(asyncio.CancelledError):
            await stopping
        assert [feed.stops for feed in created] == [1, 0, 0]
        assert manager.get_running_feed_ids() == [feed.feed_id for feed in created]
    finally:
        created[0].release.set()
        await asyncio.gather(stopping, return_exceptions=True)
        await manager.stop_all_feeds()


@pytest.mark.parametrize("count", [0, 3])
async def test_bulk_stop_success_keeps_the_existing_none_result(fleet, count):
    manager, created = fleet
    await populate(manager, count)
    assert await manager.stop_all_feeds() is None
    assert manager.get_running_feed_ids() == []
    assert all(feed.stops == 1 and not feed.resource_open for feed in created)
