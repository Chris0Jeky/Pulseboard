"""Deterministic lifecycle interleavings use real SQLite definitions, no polling."""
import asyncio
import json

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.feeds import manager as manager_module
from app.feeds.manager import FeedManager
from app.hub.hub import DataHub
from app.models import FeedDefinition


@pytest.fixture
def lifecycle(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'feeds.sqlite'}")
    SQLModel.metadata.create_all(engine)
    created = []

    class ControlledFeed:
        def __init__(self, feed_id, config, hub):
            self.feed_id, self.config = feed_id, config
            self.running = False
            self.stop_entered = asyncio.Event()
            self.stop_release = asyncio.Event()
            self.stop_release.set()
            self.stop_count = 0
            created.append(self)

        async def start(self):
            self.running = True

        async def stop(self):
            self.stop_entered.set()
            await self.stop_release.wait()
            self.stop_count += 1
            self.running = False

        def is_running(self):
            return self.running

    monkeypatch.setattr(manager_module, 'get_feed_class', lambda _: ControlledFeed)
    try:
        with Session(engine) as session:
            definition = FeedDefinition(type='fake', name='one', config_json='{"v":1}')
            session.add(definition)
            session.commit()
            session.refresh(definition)
            yield FeedManager(DataHub()), session, engine, definition, created
    finally:
        engine.dispose()


async def test_restart_cannot_overtake_a_stop_already_in_progress(lifecycle):
    manager, session, _, definition, created = lifecycle
    await manager.start_feed(definition)
    old = manager.get_feed(definition.id)
    old.stop_release.clear()
    stopping = asyncio.create_task(manager.stop_feed(definition.id))
    await asyncio.wait_for(old.stop_entered.wait(), 1)
    restarting = asyncio.create_task(manager.restart_feed(session, definition.id))
    try:
        # Run the contender up to its first suspension, not a timing-based stress test.
        await asyncio.sleep(0)
        assert len(created) == 1, 'replacement started before old stop completed'
        assert not restarting.done()
    finally:
        old.stop_release.set()
        await asyncio.gather(stopping, restarting)
    assert old.stop_count == 1
    assert not old.running
    assert manager.get_feed(definition.id) is created[-1]
    assert created[-1].running


@pytest.mark.parametrize('change', ['delete', 'disable', 'config'])
async def test_restart_reads_committed_state_not_pre_await_identity_cache(lifecycle, change):
    manager, session, engine, definition, created = lifecycle
    feed_id = definition.id
    await manager.start_feed(definition)
    old = manager.get_feed(feed_id)
    old.stop_release.clear()
    restarting = asyncio.create_task(manager.restart_feed(session, feed_id))
    await asyncio.wait_for(old.stop_entered.wait(), 1)
    try:
        # An API route already holds definition in its Session before awaiting stop.
        assert session.get(FeedDefinition, feed_id) is definition
        with Session(engine) as writer:
            current = writer.get(FeedDefinition, feed_id)
            if change == 'delete':
                writer.delete(current)
            else:
                if change == 'disable':
                    current.enabled = False
                else:
                    current.config_json = '{"v":2}'
                writer.add(current)
            writer.commit()
    finally:
        old.stop_release.set()
        result = (await asyncio.gather(restarting, return_exceptions=True))[0]
    assert old.stop_count == 1
    if change == 'delete':
        assert isinstance(result, ValueError), 'deleted cached definition was restarted'
        assert 'not found in database' in str(result)
    else:
        assert result is None
    if change in ('delete', 'disable'):
        assert len(created) == 1
        assert manager.get_feed(feed_id) is None
    else:
        assert len(created) == 2
        assert manager.get_feed(feed_id).config == {'v': 2}
        assert json.loads(definition.config_json) == {'v': 2}


async def test_cancelled_waiter_does_not_block_other_feeds_or_future_restart(lifecycle):
    manager, session, _, definition, _ = lifecycle
    await manager.start_feed(definition)
    old = manager.get_feed(definition.id)
    old.stop_release.clear()
    stopping = asyncio.create_task(manager.stop_feed(definition.id))
    await asyncio.wait_for(old.stop_entered.wait(), 1)
    waiting = asyncio.create_task(manager.restart_feed(session, definition.id))
    other = FeedDefinition(type='fake', name='independent')
    try:
        await asyncio.sleep(0)
        assert not waiting.done(), 'restart did not wait for its feed lifecycle'
        await asyncio.wait_for(manager.start_feed(other), 1)
        assert manager.is_feed_running(other.id)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
    finally:
        old.stop_release.set()
        await asyncio.gather(stopping, waiting, return_exceptions=True)
    await asyncio.wait_for(manager.restart_feed(session, definition.id), 1)
    assert manager.is_feed_running(definition.id)
    assert old.stop_count == 1
