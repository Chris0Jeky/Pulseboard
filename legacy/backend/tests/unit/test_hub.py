"""
Unit tests for DataHub.
"""

import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.hub.events import FeedEvent, FeedEventMessage
from app.hub.hub import DataHub


@pytest.fixture
def hub():
    """Create DataHub instance."""
    return DataHub(history_window=timedelta(minutes=10))


class _FakeWebSocket:
    """Small fake websocket that records sent messages."""

    def __init__(self):
        self.messages = []

    async def send_text(self, message):
        self.messages.append(message)


class _FailingFakeWebSocket(_FakeWebSocket):
    """Fake websocket whose send_text always raises."""

    def __init__(self, error=None):
        super().__init__()
        self.error = error if error is not None else Exception("Connection closed")

    async def send_text(self, message):
        raise self.error


class _UnregisterOnSendFakeWebSocket(_FakeWebSocket):
    """Fake websocket that unregisters another connection while sending."""

    def __init__(self, hub, dashboard_id, target):
        super().__init__()
        self._hub = hub
        self._dashboard_id = dashboard_id
        self._target = target

    async def send_text(self, message):
        await self._hub.unregister_connection(self._dashboard_id, self._target)
        await super().send_text(message)


class TestDataHub:
    """Tests for DataHub."""

    async def test_publish_feed_event(self, hub: DataHub):
        """Test publishing a feed event."""
        feed_id = uuid4()
        payload = {"cpu": 45.5, "memory": 60.2}

        await hub.publish_feed_event(feed_id, payload)

        # Check latest event
        latest = hub.get_latest(feed_id)
        assert latest is not None
        assert latest.feed_id == feed_id
        assert latest.payload == payload

        # Check history
        history = hub.get_history(feed_id)
        assert len(history) == 1
        assert history[0].feed_id == feed_id

    async def test_multiple_events_update_latest(self, hub: DataHub):
        """Test that multiple events update the latest value."""
        feed_id = uuid4()

        await hub.publish_feed_event(feed_id, {"value": 1})
        await hub.publish_feed_event(feed_id, {"value": 2})
        await hub.publish_feed_event(feed_id, {"value": 3})

        latest = hub.get_latest(feed_id)
        assert latest.payload["value"] == 3

        history = hub.get_history(feed_id)
        assert len(history) == 3

    async def test_history_window_trimming(self, hub: DataHub):
        """Test that old events are trimmed from history."""
        # Create hub with short window
        short_hub = DataHub(history_window=timedelta(seconds=1))
        feed_id = uuid4()

        # Publish event
        await short_hub.publish_feed_event(feed_id, {"value": 1})
        assert len(short_hub.get_history(feed_id)) == 1

        # Wait for window to expire
        await asyncio.sleep(1.5)

        # Publish new event (should trigger trimming)
        await short_hub.publish_feed_event(feed_id, {"value": 2})

        # Old event should be trimmed
        history = short_hub.get_history(feed_id)
        assert len(history) == 1
        assert history[0].payload["value"] == 2

    async def test_get_history_with_since_filter(self, hub: DataHub):
        """Test filtering history by timestamp."""
        feed_id = uuid4()

        # Publish events with small delays
        await hub.publish_feed_event(feed_id, {"value": 1})
        await asyncio.sleep(0.1)

        timestamp = datetime.utcnow()
        await asyncio.sleep(0.1)

        await hub.publish_feed_event(feed_id, {"value": 2})
        await hub.publish_feed_event(feed_id, {"value": 3})

        # Get history since timestamp
        history = hub.get_history(feed_id, since=timestamp)

        # Should only get events 2 and 3
        assert len(history) == 2
        assert history[0].payload["value"] == 2
        assert history[1].payload["value"] == 3

    async def test_get_history_with_limit(self, hub: DataHub):
        """Test limiting history results."""
        feed_id = uuid4()

        for i in range(10):
            await hub.publish_feed_event(feed_id, {"value": i})

        history = hub.get_history(feed_id, limit=5)

        assert len(history) == 5
        # Should get the last 5 events
        assert history[-1].payload["value"] == 9

    async def test_register_connection(self, hub: DataHub):
        """Test registering a WebSocket connection."""
        dashboard_id = uuid4()
        feed_id = uuid4()
        websocket = MagicMock()
        websocket.send_text = AsyncMock()

        # Publish an event first
        await hub.publish_feed_event(feed_id, {"value": 42})

        # Register connection
        await hub.register_connection(dashboard_id, websocket, {feed_id})

        # Check connection is registered
        assert dashboard_id in hub.connections
        assert websocket in hub.connections[dashboard_id]
        assert feed_id in hub.dashboard_feeds[dashboard_id]

        # Check initial state was sent
        websocket.send_text.assert_called_once()

    async def test_unregister_connection(self, hub: DataHub):
        """Test unregistering a WebSocket connection."""
        dashboard_id = uuid4()
        feed_id = uuid4()
        websocket = MagicMock()
        websocket.send_text = AsyncMock()

        await hub.register_connection(dashboard_id, websocket, {feed_id})
        await hub.unregister_connection(dashboard_id, websocket)

        # Connection should be removed
        assert websocket not in hub.connections.get(dashboard_id, [])

    async def test_broadcast_to_relevant_dashboards(self, hub: DataHub):
        """Test that events are only broadcast to relevant dashboards."""
        dashboard1_id = uuid4()
        dashboard2_id = uuid4()
        feed1_id = uuid4()
        feed2_id = uuid4()

        ws1 = MagicMock()
        ws1.send_text = AsyncMock()
        ws2 = MagicMock()
        ws2.send_text = AsyncMock()

        # Dashboard 1 uses feed 1
        await hub.register_connection(dashboard1_id, ws1, {feed1_id})

        # Dashboard 2 uses feed 2
        await hub.register_connection(dashboard2_id, ws2, {feed2_id})

        # Clear initial state calls
        ws1.send_text.reset_mock()
        ws2.send_text.reset_mock()

        # Publish event for feed 1
        await hub.publish_feed_event(feed1_id, {"value": 100})

        # Only dashboard 1 should receive the event
        assert ws1.send_text.call_count == 1
        assert ws2.send_text.call_count == 0

    async def test_broadcast_to_multiple_connections(self, hub: DataHub):
        """Test broadcasting to multiple connections of same dashboard."""
        dashboard_id = uuid4()
        feed_id = uuid4()

        ws1 = MagicMock()
        ws1.send_text = AsyncMock()
        ws2 = MagicMock()
        ws2.send_text = AsyncMock()

        await hub.register_connection(dashboard_id, ws1, {feed_id})
        await hub.register_connection(dashboard_id, ws2, {feed_id})

        # Clear initial state calls
        ws1.send_text.reset_mock()
        ws2.send_text.reset_mock()

        # Publish event
        await hub.publish_feed_event(feed_id, {"value": 100})

        # Both connections should receive the event
        assert ws1.send_text.call_count == 1
        assert ws2.send_text.call_count == 1

    async def test_handle_disconnected_websocket(self, hub: DataHub):
        """Test handling disconnected WebSocket gracefully."""
        dashboard_id = uuid4()
        feed_id = uuid4()

        # Create a websocket that fails to send
        ws_broken = MagicMock()
        ws_broken.send_text = AsyncMock(side_effect=Exception("Connection closed"))

        # Create a working websocket
        ws_working = MagicMock()
        ws_working.send_text = AsyncMock()

        await hub.register_connection(dashboard_id, ws_broken, {feed_id})
        await hub.register_connection(dashboard_id, ws_working, {feed_id})

        # Clear initial state calls
        ws_working.send_text.reset_mock()

        # Publish event
        await hub.publish_feed_event(feed_id, {"value": 100})

        # Broken connection should be removed
        assert ws_broken not in hub.connections[dashboard_id]
        # Working connection should still be there and have received the event
        assert ws_working in hub.connections[dashboard_id]
        assert ws_working.send_text.call_count == 1

    async def test_broadcast_survives_disconnect_during_send(self, hub: DataHub):
        """A disconnect mid-broadcast must not break delivery to others."""
        feed_id = uuid4()
        dashboard1_id = uuid4()
        dashboard2_id = uuid4()

        ws_a = _FailingFakeWebSocket(Exception("client gone"))
        ws_b = _UnregisterOnSendFakeWebSocket(hub, dashboard1_id, ws_a)
        ws_c = _FakeWebSocket()
        ws_d2 = _FakeWebSocket()

        hub.connections[dashboard1_id].extend([ws_a, ws_b, ws_c])
        hub.dashboard_feeds[dashboard1_id].add(feed_id)
        hub.connections[dashboard2_id].append(ws_d2)
        hub.dashboard_feeds[dashboard2_id].add(feed_id)

        # Must not raise.
        await hub.publish_feed_event(feed_id, {"v": 1})

        assert len(ws_c.messages) == 1
        assert len(ws_d2.messages) == 1
        assert ws_a not in hub.connections[dashboard1_id]

    async def test_broadcast_failed_send_is_removed_once(self, hub: DataHub):
        """A failed send removes the connection once; later publishes are clean."""
        feed_id = uuid4()
        dashboard_id = uuid4()

        ws_broken = _FailingFakeWebSocket(Exception("Connection closed"))
        ws_working = _FakeWebSocket()

        hub.connections[dashboard_id].extend([ws_broken, ws_working])
        hub.dashboard_feeds[dashboard_id].add(feed_id)

        await hub.publish_feed_event(feed_id, {"value": 1})

        assert hub.connections[dashboard_id] == [ws_working]

        await hub.publish_feed_event(feed_id, {"value": 2})

        assert hub.connections[dashboard_id] == [ws_working]
        assert len(ws_working.messages) == 2

    async def test_broadcast_last_failed_connection_cleans_up_dashboard(
        self, hub: DataHub
    ):
        """The last failing connection removes the dashboard entries."""
        feed_id = uuid4()
        dashboard_id = uuid4()

        ws_broken = _FailingFakeWebSocket(Exception("Connection closed"))

        hub.connections[dashboard_id].append(ws_broken)
        hub.dashboard_feeds[dashboard_id].add(feed_id)

        await hub.publish_feed_event(feed_id, {"value": 1})

        assert dashboard_id not in hub.connections
        assert dashboard_id not in hub.dashboard_feeds

    async def test_clear_feed_data(self, hub: DataHub):
        """Test clearing all data for a feed."""
        feed_id = uuid4()

        # Publish some events
        await hub.publish_feed_event(feed_id, {"value": 1})
        await hub.publish_feed_event(feed_id, {"value": 2})

        assert hub.get_latest(feed_id) is not None
        assert len(hub.get_history(feed_id)) == 2

        # Clear data
        hub.clear_feed_data(feed_id)

        assert hub.get_latest(feed_id) is None
        assert len(hub.get_history(feed_id)) == 0


class TestFeedEventMessage:
    """Tests for FeedEventMessage."""

    def test_from_feed_event(self):
        """Test creating message from FeedEvent."""
        feed_id = uuid4()
        ts = datetime.utcnow()
        payload = {"cpu": 45.5}

        event = FeedEvent(feed_id=feed_id, ts=ts, payload=payload)
        message = FeedEventMessage.from_feed_event(event)

        assert message.type == "feed_update"
        assert message.feed_id == feed_id
        assert message.ts == ts
        assert message.payload == payload

    def test_message_serialization(self):
        """Test that message can be serialized to JSON."""
        feed_id = uuid4()
        message = FeedEventMessage(
            feed_id=feed_id, ts=datetime.utcnow(), payload={"value": 42}
        )

        json_str = message.model_dump_json()
        assert isinstance(json_str, str)
        assert str(feed_id) in json_str
        assert "feed_update" in json_str
