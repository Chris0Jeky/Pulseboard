"""
Integration tests for REST API endpoints.
"""

import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine, select
from sqlmodel.pool import StaticPool

from app.api.deps import get_session
from app.db.base import SQLModel
from app.main import app
from app.models import Dashboard, FeedDefinition, Panel


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


@pytest.fixture(name="client")
def client_fixture(session: Session):
    """Create test client with database session override."""

    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


class TestDashboardAPI:
    """Tests for dashboard API endpoints."""

    def test_create_dashboard(self, client: TestClient):
        """Test creating a dashboard."""
        response = client.post(
            "/api/dashboards",
            json={"name": "Test Dashboard", "description": "Test description"},
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Test Dashboard"
        assert data["description"] == "Test description"
        assert "id" in data
        assert "created_at" in data

    def test_list_dashboards(self, client: TestClient, session: Session):
        """Test listing dashboards."""
        # Create test dashboards
        dashboard1 = Dashboard(name="Dashboard 1")
        dashboard2 = Dashboard(name="Dashboard 2")
        session.add(dashboard1)
        session.add(dashboard2)
        session.commit()

        response = client.get("/api/dashboards")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["name"] == "Dashboard 1"
        assert data[1]["name"] == "Dashboard 2"

    def test_get_dashboard(self, client: TestClient, session: Session):
        """Test getting a specific dashboard."""
        dashboard = Dashboard(name="Test Dashboard")
        session.add(dashboard)
        session.commit()

        response = client.get(f"/api/dashboards/{dashboard.id}")

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Dashboard"
        assert data["id"] == str(dashboard.id)

    def test_get_dashboard_not_found(self, client: TestClient):
        """Test getting non-existent dashboard."""
        fake_id = uuid4()
        response = client.get(f"/api/dashboards/{fake_id}")

        assert response.status_code == 404

    def test_update_dashboard(self, client: TestClient, session: Session):
        """Test updating a dashboard."""
        dashboard = Dashboard(name="Original Name")
        session.add(dashboard)
        session.commit()

        response = client.patch(
            f"/api/dashboards/{dashboard.id}",
            json={"name": "Updated Name", "description": "New description"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["description"] == "New description"

    def test_delete_dashboard(self, client: TestClient, session: Session):
        """Test deleting a dashboard."""
        dashboard = Dashboard(name="To Delete")
        session.add(dashboard)
        session.commit()
        dashboard_id = dashboard.id

        response = client.delete(f"/api/dashboards/{dashboard_id}")

        assert response.status_code == 204

        # Verify deletion
        deleted = session.get(Dashboard, dashboard_id)
        assert deleted is None

    def test_get_dashboard_feed_ids(self, client: TestClient, session: Session):
        """Test getting feed IDs used by a dashboard."""
        dashboard = Dashboard(name="Test Dashboard")
        feed_id1 = uuid4()
        feed_id2 = uuid4()

        panel1 = Panel(
            type="stat",
            title="Panel 1",
            feed_ids_json=json.dumps([str(feed_id1)]),
            position_x=0,
            position_y=0,
        )
        panel2 = Panel(
            type="timeseries",
            title="Panel 2",
            feed_ids_json=json.dumps([str(feed_id2)]),
            position_x=1,
            position_y=0,
        )

        dashboard.panels.append(panel1)
        dashboard.panels.append(panel2)
        session.add(dashboard)
        session.commit()

        response = client.get(f"/api/dashboards/{dashboard.id}/feed-ids")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert str(feed_id1) in data
        assert str(feed_id2) in data


class TestFeedAPI:
    """Tests for feed API endpoints."""

    def test_create_feed(self, client: TestClient):
        """Test creating a feed."""
        response = client.post(
            "/api/feeds",
            json={
                "type": "system_metrics",
                "name": "System Feed",
                "config_json": '{"interval_sec": 5}',
                "enabled": True,
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["type"] == "system_metrics"
        assert data["name"] == "System Feed"
        assert data["enabled"] is True

    def test_create_feed_invalid_type(self, client: TestClient):
        """Test creating feed with invalid type."""
        response = client.post(
            "/api/feeds",
            json={
                "type": "invalid_type",
                "name": "Invalid Feed",
                "config_json": "{}",
            },
        )

        assert response.status_code == 400
        assert "Unknown feed type" in response.json()["detail"]

    def test_create_feed_invalid_json(self, client: TestClient):
        """Test creating feed with invalid JSON config."""
        response = client.post(
            "/api/feeds",
            json={
                "type": "system_metrics",
                "name": "Invalid Feed",
                "config_json": "not valid json",
            },
        )

        assert response.status_code == 400
        assert "Invalid JSON" in response.json()["detail"]

    def test_list_feeds(self, client: TestClient, session: Session):
        """Test listing feeds."""
        feed1 = FeedDefinition(type="system_metrics", name="Feed 1", enabled=True)
        feed2 = FeedDefinition(type="system_metrics", name="Feed 2", enabled=False)
        session.add(feed1)
        session.add(feed2)
        session.commit()

        response = client.get("/api/feeds")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

    def test_get_feed(self, client: TestClient, session: Session):
        """Test getting a specific feed."""
        feed = FeedDefinition(type="system_metrics", name="Test Feed")
        session.add(feed)
        session.commit()

        response = client.get(f"/api/feeds/{feed.id}")

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Feed"

    def test_update_feed(self, client: TestClient, session: Session):
        """Test updating a feed."""
        feed = FeedDefinition(type="system_metrics", name="Original", enabled=True)
        session.add(feed)
        session.commit()

        response = client.patch(
            f"/api/feeds/{feed.id}", json={"name": "Updated", "enabled": False}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated"
        assert data["enabled"] is False

    def test_delete_feed(self, client: TestClient, session: Session):
        """Test deleting a feed."""
        feed = FeedDefinition(type="system_metrics", name="To Delete")
        session.add(feed)
        session.commit()
        feed_id = feed.id

        response = client.delete(f"/api/feeds/{feed_id}")

        assert response.status_code == 204

        # Verify deletion
        deleted = session.get(FeedDefinition, feed_id)
        assert deleted is None


class TestPanelAPI:
    """Tests for panel API endpoints."""

    def test_create_panel(self, client: TestClient, session: Session):
        """Test creating a panel."""
        dashboard = Dashboard(name="Test Dashboard")
        session.add(dashboard)
        session.commit()

        response = client.post(
            f"/api/dashboards/{dashboard.id}/panels",
            json={
                "type": "stat",
                "title": "CPU Usage",
                "feed_ids_json": "[]",
                "options_json": "{}",
                "position_x": 0,
                "position_y": 0,
                "width": 4,
                "height": 3,
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "CPU Usage"
        assert data["type"] == "stat"
        assert data["dashboard_id"] == str(dashboard.id)

    def test_create_panel_dashboard_not_found(self, client: TestClient):
        """Test creating panel for non-existent dashboard."""
        fake_id = uuid4()
        response = client.post(
            f"/api/dashboards/{fake_id}/panels",
            json={"type": "stat", "title": "Test", "position_x": 0, "position_y": 0},
        )

        assert response.status_code == 404

    def test_update_panel(self, client: TestClient, session: Session):
        """Test updating a panel."""
        dashboard = Dashboard(name="Test Dashboard")
        panel = Panel(type="stat", title="Original", position_x=0, position_y=0)
        dashboard.panels.append(panel)
        session.add(dashboard)
        session.commit()

        response = client.patch(
            f"/api/dashboards/{dashboard.id}/panels/{panel.id}",
            json={"title": "Updated Title", "width": 6},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Updated Title"
        assert data["width"] == 6

    def test_delete_panel(self, client: TestClient, session: Session):
        """Test deleting a panel."""
        dashboard = Dashboard(name="Test Dashboard")
        panel = Panel(type="stat", title="To Delete", position_x=0, position_y=0)
        dashboard.panels.append(panel)
        session.add(dashboard)
        session.commit()
        panel_id = panel.id

        response = client.delete(f"/api/dashboards/{dashboard.id}/panels/{panel_id}")

        assert response.status_code == 204

        # Verify deletion
        deleted = session.get(Panel, panel_id)
        assert deleted is None

    def test_get_panel(self, client: TestClient, session: Session):
        """Test getting a panel by ID."""
        dashboard = Dashboard(name="Test Dashboard")
        panel = Panel(type="stat", title="Test Panel", position_x=0, position_y=0)
        dashboard.panels.append(panel)
        session.add(dashboard)
        session.commit()

        response = client.get(f"/api/panels/{panel.id}")

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Panel"
