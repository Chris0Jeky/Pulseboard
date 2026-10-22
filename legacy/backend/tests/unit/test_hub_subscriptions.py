"""Connection subscriptions must not leak into other clients of a dashboard."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.hub.events import FeedEventMessage
from app.hub.hub import DataHub


def socket():
    websocket = MagicMock()
    websocket.send_text = AsyncMock()
    websocket.close = AsyncMock()
    return websocket


async def test_disconnect_prunes_only_departing_connections_feeds():
    hub = DataHub()
    dashboard = uuid4()
    shared, remaining_feed, departing_feed = uuid4(), uuid4(), uuid4()
    remaining, departing = socket(), socket()
    await hub.register_connection(dashboard, remaining, {shared, remaining_feed})
    await hub.register_connection(dashboard, departing, {shared, departing_feed})

    await hub.unregister_connection(dashboard, departing)
    await hub.unregister_connection(dashboard, departing)  # Disconnect is idempotent.
    await hub.publish_feed_event(departing_feed, {"value": 1})
    remaining.send_text.assert_not_awaited()
    assert hub.dashboard_feeds[dashboard] == {shared, remaining_feed}

    await hub.publish_feed_event(shared, {"value": 2})
    remaining.send_text.assert_awaited_once()
    departing.send_text.assert_not_awaited()


async def test_connected_clients_only_receive_their_own_feeds():
    hub = DataHub()
    dashboard = uuid4()
    first_feed, second_feed = uuid4(), uuid4()
    first, second = socket(), socket()
    await hub.register_connection(dashboard, first, {first_feed})
    await hub.register_connection(dashboard, second, {second_feed})

    await hub.publish_feed_event(second_feed, {"value": 1})
    first.send_text.assert_not_awaited()
    second.send_text.assert_awaited_once()


async def test_refresh_preserves_other_connections_and_sends_own_added_state():
    hub = DataHub()
    dashboard = uuid4()
    first_feed, second_feed = uuid4(), uuid4()
    first, second = socket(), socket()
    await hub.register_connection(dashboard, first, {first_feed})
    await hub.register_connection(dashboard, second, {second_feed})
    await hub.publish_feed_event(second_feed, {"value": 42})
    first.send_text.reset_mock()
    second.send_text.reset_mock()

    await hub.refresh_dashboard_feeds(dashboard, first, {second_feed})
    first.send_text.assert_awaited_once()
    event = FeedEventMessage.model_validate_json(first.send_text.call_args.args[0])
    assert event.feed_id == second_feed
    assert event.payload == {"value": 42}

    await hub.refresh_dashboard_feeds(dashboard, first, set())
    assert hub.dashboard_feeds[dashboard] == {second_feed}
    first.send_text.reset_mock()
    await hub.publish_feed_event(second_feed, {"value": 43})
    first.send_text.assert_not_awaited()
    second.send_text.assert_awaited_once()


async def test_failed_send_prunes_departing_connections_feeds():
    hub = DataHub()
    dashboard = uuid4()
    first_feed, second_feed = uuid4(), uuid4()
    first, second = socket(), socket()
    second.send_text.side_effect = RuntimeError("disconnected")
    await hub.register_connection(dashboard, first, {first_feed})
    await hub.register_connection(dashboard, second, {second_feed})

    await hub.publish_feed_event(second_feed, {"value": 1})
    assert hub.connections[dashboard] == [first]
    assert hub.dashboard_feeds[dashboard] == {first_feed}
    first.send_text.assert_not_awaited()
