"""
Integration tests for WebSocket functionality.
"""

import asyncio
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine
from sqlmodel.pool import StaticPool

from app.db.base import SQLModel
from app.hub.events import FeedEvent
from app.hub.hub import DataHub
from app.main import app
from app.models import Dashboard, FeedDefinition, Panel
from app.ws import router as ws_router


@pytest.fixture(name="session")
def session_fixture():
    """Create test database session."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(name="hub")
def hub_fixture():
    """Create DataHub instance."""
    return DataHub()


@pytest.fixture(name="client")
def client_fixture(session: Session, hub: DataHub):
    """Create test client with database and hub overrides."""
    from app.api.deps import get_session

    def get_session_override():
        return session

    # Set the hub for WebSocket router
    ws_router.set_hub(hub)

    app.dependency_overrides[get_session] = get_session_override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


class TestWebSocketConnection:
    """Tests for WebSocket connection handling."""

    def test_websocket_connect_to_dashboard(self, client: TestClient, session: Session):
        """Test successful WebSocket connection to a dashboard."""
        # Create a dashboard
        dashboard = Dashboard(name="Test Dashboard")
        session.add(dashboard)
        session.commit()

        # Connect via WebSocket
        with client.websocket_connect(f"/ws/dashboards/{dashboard.id}") as websocket:
            # Connection should be established
            assert websocket is not None

    def test_websocket_connect_nonexistent_dashboard(
        self, client: TestClient
    ):
        """Test WebSocket connection to non-existent dashboard."""
        fake_id = uuid4()

        # This should close the connection
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/dashboards/{fake_id}"):
                pass

    def test_websocket_ping_pong(self, client: TestClient, session: Session):
        """Test WebSocket ping/pong messages."""
        dashboard = Dashboard(name="Test Dashboard")
        session.add(dashboard)
        session.commit()

        with client.websocket_connect(f"/ws/dashboards/{dashboard.id}") as websocket:
            # Send ping
            websocket.send_text(json.dumps({"type": "ping"}))

            # Receive pong
            response = websocket.receive_text()
            data = json.loads(response)
            assert data["type"] == "pong"


class TestWebSocketDataFlow:
    """Tests for WebSocket data streaming."""

    @pytest.mark.asyncio
    async def test_feed_event_broadcast(
        self, client: TestClient, session: Session, hub: DataHub
    ):
        """Test that feed events are broadcast to connected clients."""
        # Create dashboard with panel
        dashboard = Dashboard(name="Test Dashboard")
        feed = FeedDefinition(type="system_metrics", name="System Feed")
        panel = Panel(
            type="stat",
            title="Test Panel",
            feed_ids_json=json.dumps([str(feed.id)]),
            position_x=0,
            position_y=0,
        )
        dashboard.panels.append(panel)
        session.add(dashboard)
        session.add(feed)
        session.commit()

        # Connect WebSocket
        with client.websocket_connect(f"/ws/dashboards/{dashboard.id}") as websocket:
            # Publish a feed event
            await hub.publish_feed_event(feed.id, {"cpu": 50.5, "ram": 70.2})

            # Should receive the event
            response = websocket.receive_text()
            data = json.loads(response)

            assert data["type"] == "feed_update"
            assert data["feed_id"] == str(feed.id)
            assert data["payload"]["cpu"] == 50.5
            assert data["payload"]["ram"] == 70.2

    @pytest.mark.asyncio
    async def test_only_relevant_feeds_broadcast(
        self, client: TestClient, session: Session, hub: DataHub
    ):
        """Test that only relevant feed events are sent to dashboard."""
        # Create dashboard with one feed
        dashboard = Dashboard(name="Test Dashboard")
        feed1 = FeedDefinition(type="system_metrics", name="Feed 1")
        feed2 = FeedDefinition(type="http_json", name="Feed 2")

        panel = Panel(
            type="stat",
            title="Test Panel",
            feed_ids_json=json.dumps([str(feed1.id)]),  # Only feed1
            position_x=0,
            position_y=0,
        )
        dashboard.panels.append(panel)

        session.add(dashboard)
        session.add(feed1)
        session.add(feed2)
        session.commit()

        with client.websocket_connect(f"/ws/dashboards/{dashboard.id}") as websocket:
            # Publish event for feed2 (not subscribed)
            await hub.publish_feed_event(feed2.id, {"value": 100})

            # Publish event for feed1 (subscribed)
            await hub.publish_feed_event(feed1.id, {"value": 200})

            # Should only receive feed1 event
            response = websocket.receive_text()
            data = json.loads(response)

            assert data["feed_id"] == str(feed1.id)
            assert data["payload"]["value"] == 200

    @pytest.mark.asyncio
    async def test_multiple_clients_receive_events(
        self, session: Session, hub: DataHub
    ):
        """Test that multiple clients connected to same dashboard receive events."""
        # Create dashboard
        dashboard = Dashboard(name="Test Dashboard")
        feed = FeedDefinition(type="system_metrics", name="System Feed")
        panel = Panel(
            type="stat",
            title="Test Panel",
            feed_ids_json=json.dumps([str(feed.id)]),
            position_x=0,
            position_y=0,
        )
        dashboard.panels.append(panel)
        session.add(dashboard)
        session.add(feed)
        session.commit()

        # Manually register multiple connections to simulate multiple clients
        # (TestClient doesn't easily support multiple concurrent WebSocket connections)
        from unittest.mock import AsyncMock, MagicMock

        ws1 = MagicMock()
        ws1.send_text = AsyncMock()
        ws2 = MagicMock()
        ws2.send_text = AsyncMock()

        await hub.register_connection(dashboard.id, ws1, {feed.id})
        await hub.register_connection(dashboard.id, ws2, {feed.id})

        # Publish event
        await hub.publish_feed_event(feed.id, {"cpu": 75})

        # Both connections should receive the event
        assert ws1.send_text.call_count >= 1
        assert ws2.send_text.call_count >= 1


class TestWebSocketDisconnection:
    """Tests for WebSocket disconnection handling."""

    @pytest.mark.asyncio
    async def test_disconnection_cleanup(self, session: Session, hub: DataHub):
        """Test that disconnection cleans up resources."""
        from unittest.mock import MagicMock, AsyncMock

        dashboard = Dashboard(name="Test Dashboard")
        feed = FeedDefinition(type="system_metrics", name="System Feed")
        session.add(dashboard)
        session.add(feed)
        session.commit()

        ws = MagicMock()
        ws.send_text = AsyncMock()

        # Register connection
        await hub.register_connection(dashboard.id, ws, {feed.id})

        assert dashboard.id in hub.connections
        assert ws in hub.connections[dashboard.id]

        # Unregister connection
        await hub.unregister_connection(dashboard.id, ws)

        assert ws not in hub.connections.get(dashboard.id, [])
