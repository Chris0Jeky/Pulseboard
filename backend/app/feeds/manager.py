"""
FeedManager for managing feed lifecycle.
"""

import json
import logging
from typing import Dict
from uuid import UUID

from sqlmodel import Session, select

from app.db.session import get_session
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
        self.logger = logging.getLogger(__name__)

    async def load_feeds(self, session: Session) -> None:
        """
        Load all enabled feeds from database and start them.

        Args:
            session: Database session
        """
        self.logger.info("Loading feeds from database")

        # Query enabled feeds
        statement = select(FeedDefinition).where(FeedDefinition.enabled == True)  # noqa: E712
        feed_definitions = session.exec(statement).all()

        self.logger.info(f"Found {len(feed_definitions)} enabled feeds")

        for feed_def in feed_definitions:
            try:
                await self.start_feed(feed_def)
            except Exception as e:
                self.logger.error(
                    f"Failed to start feed {feed_def.id} ({feed_def.name}): {e}", exc_info=True
                )

    async def start_feed(self, feed_def: FeedDefinition) -> None:
        """
        Start a single feed.

        Args:
            feed_def: FeedDefinition from database
        """
        # Check if already running
        if feed_def.id in self.feeds and self.feeds[feed_def.id].is_running():
            self.logger.warning(f"Feed {feed_def.id} is already running")
            return

        # Get feed class
        feed_class = get_feed_class(feed_def.type)
        if not feed_class:
            raise ValueError(f"Unknown feed type: {feed_def.type}")

        # Parse config
        try:
            config = json.loads(feed_def.config_json)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid config JSON for feed {feed_def.id}: {e}")

        # Instantiate feed
        feed = feed_class(feed_id=feed_def.id, config=config, hub=self.hub)

        # Start feed
        await feed.start()

        # Store in registry
        self.feeds[feed_def.id] = feed

        self.logger.info(f"Started feed {feed_def.id} ({feed_def.name}) of type {feed_def.type}")

    async def stop_feed(self, feed_id: UUID) -> None:
        """
        Stop a feed.

        Args:
            feed_id: Feed identifier
        """
        feed = self.feeds.get(feed_id)
        if not feed:
            self.logger.warning(f"Feed {feed_id} not found in manager")
            return

        await feed.stop()
        del self.feeds[feed_id]

        # Clear feed data from hub
        self.hub.clear_feed_data(feed_id)

        self.logger.info(f"Stopped feed {feed_id}")

    async def restart_feed(self, session: Session, feed_id: UUID) -> None:
        """
        Restart a feed (stop and start with fresh config).

        Args:
            session: Database session
            feed_id: Feed identifier
        """
        # Stop existing feed
        await self.stop_feed(feed_id)

        # Load fresh definition from DB
        feed_def = session.get(FeedDefinition, feed_id)
        if not feed_def:
            raise ValueError(f"Feed {feed_id} not found in database")

        if feed_def.enabled:
            await self.start_feed(feed_def)

    async def stop_all_feeds(self) -> None:
        """Stop all running feeds."""
        self.logger.info("Stopping all feeds")

        feed_ids = list(self.feeds.keys())
        for feed_id in feed_ids:
            await self.stop_feed(feed_id)

        self.logger.info("All feeds stopped")

    def get_feed(self, feed_id: UUID) -> BaseFeed | None:
        """
        Get a running feed by ID.

        Args:
            feed_id: Feed identifier

        Returns:
            BaseFeed instance or None if not running
        """
        return self.feeds.get(feed_id)

    def get_running_feed_ids(self) -> list[UUID]:
        """
        Get list of all running feed IDs.

        Returns:
            List of feed UUIDs
        """
        return list(self.feeds.keys())

    def is_feed_running(self, feed_id: UUID) -> bool:
        """
        Check if a feed is running.

        Args:
            feed_id: Feed identifier

        Returns:
            True if feed is running
        """
        feed = self.feeds.get(feed_id)
        return feed is not None and feed.is_running()
