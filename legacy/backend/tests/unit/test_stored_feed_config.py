"""Stored JSON must be an object before a feed can own a polling task (#253)."""

import asyncio
from unittest.mock import Mock

import pytest
from app.feeds import manager as manager_module
from app.feeds.manager import FeedManager
from app.feeds.system_metrics import SystemMetricsFeed
from app.hub.hub import DataHub
from app.models import FeedDefinition
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def persist(session, config):
    definition = FeedDefinition(
        name="Stored metrics", type="system_metrics", config_json=config,
    )
    session.add(definition)
    session.commit()
    session.refresh(definition)
    return definition


@pytest.mark.parametrize("config", ["null", "true", "7", '"text"', "[]", "[{}]"])
@pytest.mark.parametrize("operation", ["start", "restart"])
async def test_non_object_config_is_rejected_before_construction(
    session, monkeypatch, config, operation,
):
    definition = persist(session, config)
    manager = FeedManager(DataHub())
    constructor = Mock(wraps=SystemMetricsFeed)
    monkeypatch.setattr(manager_module, "get_feed_class", lambda _: constructor)

    try:
        with pytest.raises(ValueError, match="config_json must be a JSON object"):
            if operation == "start":
                await manager.start_feed(definition)
            else:
                await manager.restart_feed(session, definition.id)
        constructor.assert_not_called()
        assert manager.feeds == {}
    finally:
        await manager.stop_all_feeds()


async def test_load_skips_invalid_rows_and_valid_feed_reaches_real_fetch(
    session, monkeypatch, caplog,
):
    invalid = [persist(session, config) for config in ("null", "42", "[]")]
    valid = persist(session, '{"interval_sec": 1}')
    hub = DataHub()
    manager = FeedManager(hub)
    published = asyncio.Event()
    publish = hub.publish_feed_event

    async def observe_publish(feed_id, payload):
        await publish(feed_id, payload)
        published.set()

    monkeypatch.setattr(hub, "publish_feed_event", observe_publish)
    constructor = Mock(wraps=SystemMetricsFeed)
    monkeypatch.setattr(manager_module, "get_feed_class", lambda _: constructor)
    # Re-read config_json from SQLite, rather than testing only in-memory rows.
    session.expire_all()
    try:
        await manager.load_feeds(session)
        assert manager.get_running_feed_ids() == [valid.id]
        constructor.assert_called_once()
        for definition in invalid:
            assert str(definition.id) in caplog.text
            assert hub.get_latest(definition.id) is None

        feed = manager.get_feed(valid.id)
        task = feed._task
        await asyncio.wait_for(published.wait(), timeout=5)
        event = hub.get_latest(valid.id)
        assert 0 <= event.payload["cpu_percent"] <= 100
        assert event.payload["memory_total_gb"] > 0
        assert manager.is_feed_running(valid.id)
    finally:
        await manager.stop_all_feeds()

    assert manager.feeds == {}
    assert task.done() and not task.cancelled()
    assert task.exception() is None
    assert feed._task is None
    assert hub.get_latest(valid.id) is None
