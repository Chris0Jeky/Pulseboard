"""
Unit tests for FeedManager lifecycle.

Uses an in-memory SQLite database with FeedDefinition rows and a tiny fake
feed class (registered by monkeypatching app.feeds.manager.get_feed_class)
so no network access or real polling happens.
"""

import json
import logging
from uuid import uuid4

import pytest
from app.feeds import manager as manager_module
from app.feeds.manager import FeedManager
from app.hub.hub import DataHub
from app.models import FeedDefinition
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture
def hub():
    """Create a real DataHub instance."""
    return DataHub()


@pytest.fixture
def manager(hub):
    """Create a FeedManager bound to the test hub."""
    return FeedManager(hub)


@pytest.fixture
def db_session():
    """Create an in-memory SQLite session with all tables."""
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture
def fake_feed():
    """Build a tiny fake feed class plus its registry of created instances."""
    created = []

    class FakeFeed:
        """Minimal feed double recording start/stop and reporting is_running."""

        def __init__(self, feed_id, config, hub):
            self.feed_id = feed_id
            self.config = config
            self.hub = hub
            self.start_count = 0
            self.stop_count = 0
            self._running = False
            created.append(self)

        async def start(self):
            self.start_count += 1
            self._running = True

        async def stop(self):
            self.stop_count += 1
            self._running = False

        def is_running(self):
            return self._running

    return FakeFeed, created


def _add_def(db_session, *, feed_type="fake", name="feed", config="{}", enabled=True):
    """Insert a FeedDefinition row and return the refreshed instance."""
    feed_def = FeedDefinition(
        type=feed_type, name=name, config_json=config, enabled=enabled
    )
    db_session.add(feed_def)
    db_session.commit()
    db_session.refresh(feed_def)
    return feed_def


def _register(monkeypatch, feed_class):
    """Point the manager at the fake feed class."""
    monkeypatch.setattr(manager_module, "get_feed_class", lambda feed_type: feed_class)


class TestFeedManager:
    """Tests for FeedManager start/stop/restart behaviour."""

    async def test_load_feeds_starts_only_enabled_feeds(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Only enabled definitions end up running after load."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)
        enabled_def = _add_def(db_session, name="on", enabled=True)
        disabled_def = _add_def(db_session, name="off", enabled=False)

        await manager.load_feeds(db_session)

        assert manager.get_feed(enabled_def.id) is not None
        assert manager.get_feed(disabled_def.id) is None
        assert manager.get_running_feed_ids() == [enabled_def.id]
        assert manager.is_feed_running(enabled_def.id) is True
        assert manager.is_feed_running(disabled_def.id) is False

    async def test_load_feeds_with_empty_database_starts_nothing(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Boundary: zero definitions leaves the manager empty."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)

        await manager.load_feeds(db_session)

        assert manager.get_running_feed_ids() == []
        assert manager.feeds == {}

    async def test_load_feeds_continues_when_one_feed_fails_to_start(
        self, manager, db_session, fake_feed, monkeypatch, caplog
    ):
        """A start failure is logged and the remaining feeds still start."""
        fake_class, _ = fake_feed

        class BoomFeed(fake_class):
            async def start(self):
                raise RuntimeError("boom")

        def getter(feed_type):
            return BoomFeed if feed_type == "boom" else fake_class

        monkeypatch.setattr(manager_module, "get_feed_class", getter)
        boom_def = _add_def(db_session, feed_type="boom", name="boom")
        good_def = _add_def(db_session, feed_type="fake", name="good")

        with caplog.at_level(logging.ERROR, logger="app.feeds.manager"):
            await manager.load_feeds(db_session)

        assert manager.get_feed(good_def.id) is not None
        assert manager.get_feed(boom_def.id) is None
        assert manager.get_running_feed_ids() == [good_def.id]
        assert "Failed to start feed" in caplog.text

    async def test_start_feed_runs_feed_with_parsed_config(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """A valid definition starts and its JSON config is parsed."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)
        feed_def = _add_def(db_session, config=json.dumps({"interval_sec": 5}))

        await manager.start_feed(feed_def)

        feed = manager.get_feed(feed_def.id)
        assert feed is not None
        assert feed.config == {"interval_sec": 5}
        assert feed.is_running() is True
        assert manager.is_feed_running(feed_def.id) is True

    async def test_start_feed_on_running_feed_starts_no_second_instance(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Starting an already-running feed returns without re-instantiating."""
        fake_class, created = fake_feed
        calls = []
        monkeypatch.setattr(
            manager_module,
            "get_feed_class",
            lambda feed_type: calls.append(feed_type) or fake_class,
        )
        feed_def = _add_def(db_session)

        await manager.start_feed(feed_def)
        first = manager.get_feed(feed_def.id)
        await manager.start_feed(feed_def)

        assert manager.get_feed(feed_def.id) is first
        assert first.start_count == 1
        assert len(calls) == 1
        assert len(created) == 1

    async def test_start_feed_rejects_unknown_type(
        self, manager, db_session, monkeypatch
    ):
        """Unknown feed type raises ValueError and registers nothing."""
        monkeypatch.setattr(manager_module, "get_feed_class", lambda feed_type: None)
        feed_def = _add_def(db_session, feed_type="nope")

        with pytest.raises(ValueError, match="Unknown feed type: nope"):
            await manager.start_feed(feed_def)

        assert manager.get_feed(feed_def.id) is None

    async def test_start_feed_rejects_invalid_config_json(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Malformed config_json raises ValueError and registers nothing."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)
        feed_def = _add_def(db_session, config="{not-json")

        with pytest.raises(ValueError, match="Invalid config JSON"):
            await manager.start_feed(feed_def)

        assert manager.get_feed(feed_def.id) is None

    async def test_start_feed_rejects_empty_config_json(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Boundary: empty config_json raises ValueError and registers nothing."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)
        feed_def = _add_def(db_session, config="")

        with pytest.raises(ValueError, match="Invalid config JSON"):
            await manager.start_feed(feed_def)

        assert manager.get_feed(feed_def.id) is None

    async def test_stop_feed_removes_feed_and_clears_hub_data(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Stopping removes the feed and clears its hub latest/history."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)
        feed_def = _add_def(db_session)
        await manager.start_feed(feed_def)
        feed = manager.get_feed(feed_def.id)
        await manager.hub.publish_feed_event(feed_def.id, {"value": 1})
        assert manager.hub.get_latest(feed_def.id) is not None

        await manager.stop_feed(feed_def.id)

        assert manager.get_feed(feed_def.id) is None
        assert manager.get_running_feed_ids() == []
        assert manager.hub.get_latest(feed_def.id) is None
        assert manager.hub.get_history(feed_def.id) == []
        assert feed.stop_count == 1
        assert feed.is_running() is False

    async def test_stop_feed_unknown_id_returns_without_raising(self, manager):
        """Boundary: stopping an id the manager never saw is a silent no-op."""
        assert await manager.stop_feed(uuid4()) is None
        assert manager.get_running_feed_ids() == []

    async def test_restart_feed_applies_new_config(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Restart replaces the instance with one built from the new config."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)
        feed_def = _add_def(db_session, config=json.dumps({"v": 1}))
        await manager.start_feed(feed_def)
        old = manager.get_feed(feed_def.id)
        feed_def.config_json = json.dumps({"v": 2})
        db_session.add(feed_def)
        db_session.commit()

        await manager.restart_feed(db_session, feed_def.id)

        new = manager.get_feed(feed_def.id)
        assert new is not old
        assert new.config == {"v": 2}
        assert old.stop_count == 1
        assert manager.is_feed_running(feed_def.id) is True

    async def test_restart_feed_leaves_disabled_feed_stopped(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Restarting after the definition was disabled stops without restarting."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)
        feed_def = _add_def(db_session, enabled=True)
        await manager.start_feed(feed_def)
        old = manager.get_feed(feed_def.id)
        feed_def.enabled = False
        db_session.add(feed_def)
        db_session.commit()

        await manager.restart_feed(db_session, feed_def.id)

        assert manager.get_feed(feed_def.id) is None
        assert manager.get_running_feed_ids() == []
        assert old.stop_count == 1

    async def test_restart_feed_missing_from_database_raises(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Restarting an id absent from the database raises ValueError."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)
        missing = uuid4()

        with pytest.raises(ValueError, match="not found in database"):
            await manager.restart_feed(db_session, missing)

    async def test_restart_feed_starts_never_started_enabled_feed(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """Boundary: restarting an enabled feed that is not running starts it."""
        fake_class, _ = fake_feed
        _register(monkeypatch, fake_class)
        feed_def = _add_def(
            db_session, config=json.dumps({"v": 7}), enabled=True
        )

        await manager.restart_feed(db_session, feed_def.id)

        assert manager.is_feed_running(feed_def.id) is True
        assert manager.get_feed(feed_def.id).config == {"v": 7}

    async def test_stop_all_feeds_stops_every_running_feed(
        self, manager, db_session, fake_feed, monkeypatch
    ):
        """stop_all_feeds empties the manager and stops each instance once."""
        fake_class, created = fake_feed
        _register(monkeypatch, fake_class)
        for name in ("a", "b", "c"):
            _add_def(db_session, name=name)
        await manager.load_feeds(db_session)
        assert len(manager.get_running_feed_ids()) == 3

        await manager.stop_all_feeds()

        assert manager.get_running_feed_ids() == []
        assert manager.feeds == {}
        assert [feed.stop_count for feed in created] == [1, 1, 1]
        assert all(feed.is_running() is False for feed in created)

    async def test_stop_all_feeds_on_empty_manager_is_noop(self, manager):
        """Boundary: stopping all feeds when none run returns cleanly."""
        assert await manager.stop_all_feeds() is None
        assert manager.feeds == {}
