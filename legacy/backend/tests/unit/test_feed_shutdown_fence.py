"""Global shutdown must fence feeds started or restarted concurrently with it."""
import asyncio

import pytest

from app.feeds import manager as manager_module
from app.feeds.manager import FeedManager
from app.hub.hub import DataHub
from app.models import FeedDefinition


@pytest.fixture
def fleet(monkeypatch):
    created = []

    class SlowStartFeed:
        gate: asyncio.Event | None = None

        def __init__(self, feed_id, config, hub):
            self.feed_id = feed_id
            self.running = False
            self.stops = 0
            self.entered = asyncio.Event()
            created.append(self)

        async def start(self):
            self.entered.set()
            if SlowStartFeed.gate is not None:
                await SlowStartFeed.gate.wait()
            self.running = True

        async def stop(self):
            self.stops += 1
            self.running = False

        def is_running(self):
            return self.running

    monkeypatch.setattr(manager_module, "get_feed_class", lambda _: SlowStartFeed)
    yield FeedManager(DataHub()), created, SlowStartFeed
    SlowStartFeed.gate = None


async def test_feed_mid_start_during_shutdown_is_stopped(fleet):
    manager, created, cls = fleet
    cls.gate = asyncio.Event()
    starting = asyncio.create_task(manager.start_feed(FeedDefinition(type="x", name="a")))
    await asyncio.wait_for(created_entered(created), 1)

    stopping = asyncio.create_task(manager.stop_all_feeds())
    await asyncio.sleep(0)
    cls.gate.set()
    await asyncio.wait_for(asyncio.gather(starting, stopping), 1)

    assert manager.get_running_feed_ids() == []
    assert created[0].stops == 1 and not created[0].running


async def test_start_after_shutdown_begins_is_refused(fleet):
    manager, created, _ = fleet
    await manager.stop_all_feeds()
    await manager.start_feed(FeedDefinition(type="x", name="late"))
    assert created == []
    assert manager.get_running_feed_ids() == []


async def test_restart_during_shutdown_does_not_resurrect_feed(fleet):
    manager, created, cls = fleet
    definition = FeedDefinition(type="x", name="a", enabled=True)
    await manager.start_feed(definition)
    await manager.stop_all_feeds()

    class _Session:
        def get(self, *_a, **_k):
            return definition

    await manager.restart_feed(_Session(), definition.id)
    assert len(created) == 1
    assert manager.get_running_feed_ids() == []


async def created_entered(created):
    while not created:
        await asyncio.sleep(0)
    await created[0].entered.wait()
