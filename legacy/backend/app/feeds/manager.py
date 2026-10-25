"""
FeedManager for managing feed lifecycle.
"""

import json
import logging
from asyncio import Lock
from typing import Dict
from uuid import UUID
from weakref import WeakValueDictionary

from sqlmodel import Session, select

from app.hub.hub import DataHub
from app.models import FeedDefinition

from . import get_feed_class
from .base import BaseFeed

logger = logging.getLogger(__name__)


class FeedManager:
    """
    Manages the lifecycle of feeds.

    - Loads feed definitions from database
    - Instantiates and starts feeds
    - Provides methods to start/stop/reload feeds
    """

    def __init__(self, hub: DataHub):
        """
        Initialize FeedManager.

        Args:
            hub: DataHub instance for feeds to publish to
        """
        self.hub = hub
        self.feeds: Dict[UUID, BaseFeed] = {}
        # Holders and waiters retain their lock; idle entries disappear rather than
        # leaking one permanent lock for every feed ever deleted. One event loop only.
        self._lifecycle_locks: WeakValueDictionary[UUID, Lock] = WeakValueDictionary()
        # Set once global shutdown begins; no feed may start after that.
        self._shutting_down = False
        self.logger = logging.getLogger(__name__)

    async def load_feeds(self, session: Session) -> None:
        """
        Load all enabled feeds from database and start them.

        Args:
            session: Database session
        """
        self.logger.info("Loading feeds from database")

        statement = select(FeedDefinition).where(FeedDefinition.enabled == True)  # noqa: E712
        feed_definitions = session.exec(statement).all()

        self.logger.info(f"Found {len(feed_definitions)} enabled feeds")

        for feed_def in feed_definitions:
            try:
                await self.start_feed(feed_def)
            except Exception as exc:
                self.logger.error(
                    f"Failed to start feed {feed_def.id} ({feed_def.name}): {exc}",
                    exc_info=True,
                )

    def _lifecycle_lock(self, feed_id: UUID) -> Lock:
        lock = self._lifecycle_locks.get(feed_id)
        if lock is None:
            lock = Lock()
            self._lifecycle_locks[feed_id] = lock
        return lock

    async def start_feed(self, feed_def: FeedDefinition) -> None:
        """Start a single feed after any earlier lifecycle operation settles."""
        async with self._lifecycle_lock(feed_def.id):
            await self._start_feed(feed_def)

    async def _start_feed(self, feed_def: FeedDefinition) -> None:
        """Start while the caller holds this feed's lifecycle lock."""
        if self._shutting_down:
            self.logger.warning(f"Not starting feed {feed_def.id}: manager is shutting down")
            return

        if feed_def.id in self.feeds and self.feeds[feed_def.id].is_running():
            self.logger.warning(f"Feed {feed_def.id} is already running")
            return

        # A stopped polling flag does not prove that plugin resources were released.
        # Finish any retained instance's cleanup under this same lifecycle lock.
        if feed_def.id in self.feeds:
            await self._stop_feed(feed_def.id)

        feed_class = get_feed_class(feed_def.type)
        if not feed_class:
            raise ValueError(f"Unknown feed type: {feed_def.type}")

        try:
            config = json.loads(feed_def.config_json)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid config JSON for feed {feed_def.id}: {exc}") from exc

        if not isinstance(config, dict):
            raise ValueError("config_json must be a JSON object")

        feed = feed_class(feed_id=feed_def.id, config=config, hub=self.hub)
        await feed.start()
        self.feeds[feed_def.id] = feed

        self.logger.info(f"Started feed {feed_def.id} ({feed_def.name}) of type {feed_def.type}")

    async def stop_feed(self, feed_id: UUID) -> None:
        """Stop a feed; concurrent callers wait for the same stop to settle."""
        async with self._lifecycle_lock(feed_id):
            await self._stop_feed(feed_id)

    async def _stop_feed(self, feed_id: UUID) -> None:
        """Stop while the caller holds this feed's lifecycle lock."""
        feed = self.feeds.get(feed_id)
        if feed is None:
            self.logger.warning(f"Feed {feed_id} not found in manager")
            return

        # Keep ownership on failure or cancellation so cleanup can be retried.
        # Nothing awaits between successful cleanup and removing the managed entry.
        await feed.stop()
        self.feeds.pop(feed_id)
        self.hub.clear_feed_data(feed_id)
        self.logger.info(f"Stopped feed {feed_id}")

    async def restart_feed(self, session: Session, feed_id: UUID) -> None:
        """Restart a feed with its current database configuration."""
        async with self._lifecycle_lock(feed_id):
            await self._stop_feed(feed_id)

            # Routes commit before calling us but may hold a cached pre-await row.
            # Force a read so a concurrent committed delete/disable/update wins.
            feed_def = session.get(FeedDefinition, feed_id, populate_existing=True)
            if not feed_def:
                raise ValueError(f"Feed {feed_id} not found in database")

            if feed_def.enabled:
                await self._start_feed(feed_def)

    async def stop_all_feeds(self) -> None:
        """Attempt each managed feed; aggregate ordinary cleanup failures."""
        self.logger.info("Stopping all feeds")
        self._shutting_down = True

        # A start or restart already past the fence holds its feed's lifecycle lock and may
        # register a feed after any snapshot taken now. Wait those operations out first;
        # every later one sees the flag and refuses to start.
        for lock in list(self._lifecycle_locks.values()):
            async with lock:
                pass

        failures: list[Exception] = []
        for feed_id in list(self.feeds.keys()):
            try:
                await self.stop_feed(feed_id)
            except Exception as exc:
                # Failed instances stay owned for retry. Cancellation still propagates.
                failures.append(exc)

        if failures:
            raise ExceptionGroup("Feed cleanup failed", failures)
        self.logger.info("All feeds stopped")

    def get_feed(self, feed_id: UUID) -> BaseFeed | None:
        """Get a managed feed, including an instance awaiting successful cleanup."""
        return self.feeds.get(feed_id)

    def get_running_feed_ids(self) -> list[UUID]:
        """Get managed IDs, including pending cleanup; query running state separately."""
        return list(self.feeds.keys())

    def is_feed_running(self, feed_id: UUID) -> bool:
        """Check whether a feed is running."""
        feed = self.feeds.get(feed_id)
        return feed is not None and feed.is_running()
