"""
Race tests for FeedManager.stop_feed concurrent double-stop.

Two concurrent stop_feed calls for the same feed id (e.g. PATCH
/api/feeds/{id} racing DELETE /api/feeds/{id}, or stop_all_feeds during
shutdown racing DELETE) must both return without raising: the first caller
claims the feed and stops it, the second sees it as already gone and
returns early. The feed itself must be stopped exactly once.
"""

import asyncio
from uuid import uuid4

from app.feeds.manager import FeedManager
from app.hub.hub import DataHub


class _YieldingFakeFeed:
    """Minimal feed double whose stop() awaits once to widen the race window."""

    def __init__(self, feed_id):
        self.feed_id = feed_id
        self.stop_count = 0
        self._running = True

    async def stop(self):
        await asyncio.sleep(0)
        self.stop_count += 1
        self._running = False

    def is_running(self):
        return self._running


def _manager_with_feed(feed_id):
    """Build a FeedManager with one running fake feed registered."""
    manager = FeedManager(DataHub())
    feed = _YieldingFakeFeed(feed_id)
    manager.feeds[feed_id] = feed
    return manager, feed


async def test_concurrent_double_stop_stops_once_without_raising():
    """Two concurrent stop_feed calls both return; the feed stops exactly once."""
    feed_id = uuid4()
    manager, feed = _manager_with_feed(feed_id)

    await asyncio.gather(
        manager.stop_feed(feed_id),
        manager.stop_feed(feed_id),
    )

    assert feed.stop_count == 1
    assert manager.get_feed(feed_id) is None
    assert feed_id not in manager.get_running_feed_ids()


async def test_sequential_double_stop_is_noop():
    """Stopping twice in sequence stops once; the second call is a no-op."""
    feed_id = uuid4()
    manager, feed = _manager_with_feed(feed_id)

    await manager.stop_feed(feed_id)
    await manager.stop_feed(feed_id)

    assert feed.stop_count == 1
    assert manager.get_feed(feed_id) is None
    assert feed_id not in manager.get_running_feed_ids()
