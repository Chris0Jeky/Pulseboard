"""Pin BaseFeed.run publish-order and swallow-and-continue behavior."""

import asyncio
from typing import Any, Dict, List
from uuid import uuid4

from app.feeds.base import BaseFeed


class FakeHub:
    """Minimal hub recording publish_feed_event payloads."""

    def __init__(self) -> None:
        self.payloads: List[Dict[str, Any]] = []

    async def publish_feed_event(self, feed_id, payload: Dict[str, Any]) -> None:
        self.payloads.append(payload)


class FakeFeed(BaseFeed):
    """Yield {"v": 1}, raise once, then yield {"v": 2} and park."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.calls = 0

    async def fetch_data(self) -> Dict[str, Any]:
        self.calls += 1
        if self.calls == 1:
            return {"v": 1}
        if self.calls == 2:
            raise RuntimeError("boom")
        if self.calls == 3:
            return {"v": 2}
        await asyncio.Future()


async def test_run_publishes_and_survives_fetch_error():
    hub = FakeHub()
    feed = FakeFeed(uuid4(), {"interval_sec": 0.01}, hub)

    task = asyncio.create_task(feed.run())
    try:
        await asyncio.wait_for(_wait_for_payloads(hub, 2), timeout=5)
        # The task survived the fetch error: still pending and later
        # payload was published in order.
        assert not task.done()
        assert hub.payloads == [{"v": 1}, {"v": 2}]
    finally:
        await feed.stop()
        await asyncio.wait_for(task, timeout=5)

    assert hub.payloads == [{"v": 1}, {"v": 2}]


async def _wait_for_payloads(hub: FakeHub, count: int) -> None:
    while len(hub.payloads) < count:
        await asyncio.sleep(0.005)
