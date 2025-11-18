"""
Base feed abstraction for all feed types.
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, Dict
from uuid import UUID

if TYPE_CHECKING:
    from app.hub.hub import DataHub

logger = logging.getLogger(__name__)


class BaseFeed(ABC):
    """
    Abstract base class for all feed types.

    Each feed knows how to fetch or receive data from a source
    and publish events to the DataHub.
    """

    def __init__(self, feed_id: UUID, config: Dict[str, Any], hub: "DataHub"):
        """
        Initialize feed.

        Args:
            feed_id: Unique feed identifier
            config: Feed-specific configuration dictionary
            hub: DataHub instance for publishing events
        """
        self.feed_id = feed_id
        self.config = config
        self.hub = hub
        self._running = False
        self._task: asyncio.Task | None = None
        self._stop_requested = False
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")

    @abstractmethod
    async def fetch_data(self) -> Dict[str, Any]:
        """
        Fetch data from the source.

        Returns:
            Dict containing the data payload

        Raises:
            Exception: If data fetching fails
        """
        ...

    async def run(self) -> None:
        """
        Main run loop that fetches data and publishes events.

        This method should be run as an asyncio Task.
        """
        self._stop_requested = False
        self._running = True
        interval = self.config.get("interval_sec", 5)

        self.logger.info(f"Starting feed {self.feed_id} with interval {interval}s")

        while self._running:
            try:
                # Wait for the configured interval before fetching
                await asyncio.sleep(interval)

                # Fetch data from source
                payload = await self.fetch_data()

                # Publish event to hub
                await self.hub.publish_feed_event(self.feed_id, payload)

                if self._stop_requested:
                    break

                # Wait for next interval
                await asyncio.sleep(interval)

            except asyncio.CancelledError:
                self.logger.info(f"Feed {self.feed_id} cancelled")
                break
            except Exception as e:
                self.logger.error(f"Error in feed {self.feed_id}: {e}", exc_info=True)
                # Continue running despite errors, wait before retry
                await asyncio.sleep(interval)

        self._running = False
        self.logger.info(f"Feed {self.feed_id} stopped")

    async def start(self) -> None:
        """Start the feed as an asyncio Task."""
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self.run())
            self.logger.info(f"Feed {self.feed_id} task started")

    async def stop(self) -> None:
        """Stop the feed."""
        self._stop_requested = True
        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(
                    self._task, timeout=self.config.get("interval_sec", 5) + 1
                )
            except asyncio.TimeoutError:
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
        self.logger.info(f"Feed {self.feed_id} stopped")

    def is_running(self) -> bool:
        """Check if feed is currently running."""
        return self._running and self._task is not None and not self._task.done()
