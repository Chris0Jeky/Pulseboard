"""High-rate feeds retain a bounded number of history events (#75)."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.hub.events import FeedEvent
from app.hub.hub import DataHub


@pytest.mark.filterwarnings("ignore:datetime.datetime.utcnow.*:DeprecationWarning")
async def test_default_history_keeps_only_the_latest_ten_thousand_events():
    hub = DataHub()
    feed_id = uuid4()
    for value in range(10_003):
        await hub.publish_feed_event(feed_id, {"value": value})
    history = hub.get_history(feed_id)
    assert len(history) == 10_000
    assert [history[0].payload["value"], history[-1].payload["value"]] == [3, 10_002]
    assert hub.get_latest(feed_id) is history[-1]


async def test_history_bound_is_per_feed_and_does_not_suppress_live_broadcast():
    hub = DataHub(history_limit=2)
    hub._broadcast_event = AsyncMock()
    first, second = uuid4(), uuid4()
    for value in range(4):
        await hub.publish_feed_event(first, {"value": value})
    await hub.publish_feed_event(second, {"value": 9})
    assert [event.payload["value"] for event in hub.get_history(first)] == [2, 3]
    assert [event.payload["value"] for event in hub.get_history(second)] == [9]
    assert hub._broadcast_event.await_count == 5
    assert [event.payload["value"] for event in hub.get_history(first, limit=1)] == [3]
    assert hub.get_history(first, since=hub.get_history(first)[-1].ts) == []


async def test_time_trimming_and_clear_still_work_with_count_bound():
    hub = DataHub(history_window=timedelta(seconds=1), history_limit=2)
    feed_id = uuid4()
    hub.history[feed_id].append(FeedEvent(
        feed_id=feed_id, ts=datetime(2000, 1, 1), payload={"value": "expired"},
    ))
    await hub.publish_feed_event(feed_id, {"value": "new"})
    assert [event.payload["value"] for event in hub.get_history(feed_id)] == ["new"]
    hub.clear_feed_data(feed_id)
    assert hub.get_latest(feed_id) is None
    assert hub.get_history(feed_id) == []
    for value in range(3):
        await hub.publish_feed_event(feed_id, {"value": value})
    assert [event.payload["value"] for event in hub.get_history(feed_id)] == [1, 2]


@pytest.mark.parametrize("limit", [0, -1, True, False, None, 1.5, "2"])
def test_invalid_history_limits_are_rejected(limit):
    with pytest.raises(ValueError, match="history_limit must be a positive integer"):
        DataHub(history_limit=limit)
