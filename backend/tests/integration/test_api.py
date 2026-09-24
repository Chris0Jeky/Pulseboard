"""
Integration tests for REST API endpoints.
"""

import json
from uuid import UUID, uuid4

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

    @pytest.mark.parametrize("field", ["name", "layout_json"])
    def test_update_dashboard_rejects_explicit_null(
        self, client: TestClient, session: Session, field: str
    ):
        """PATCH with an explicit null for a non-nullable field must fail with 422."""
        dashboard = Dashboard(
            name="Original", description="Keep me", layout_json='{"a": 1}'
        )
        session.add(dashboard)
        session.commit()
        session.refresh(dashboard)

        response = client.patch(
            f"/api/dashboards/{dashboard.id}", json={field: None}
        )

        assert response.status_code == 422
        assert response.json()["detail"] == f"{field} cannot be null"
        session.refresh(dashboard)
        assert dashboard.name == "Original"
        assert dashboard.description == "Keep me"
        assert dashboard.layout_json == '{"a": 1}'

    def test_update_dashboard_allows_null_description(
        self, client: TestClient, session: Session
    ):
        """PATCH with null description must clear it (description is nullable)."""
        dashboard = Dashboard(name="Original", description="Keep me")
        session.add(dashboard)
        session.commit()
        session.refresh(dashboard)

        response = client.patch(
            f"/api/dashboards/{dashboard.id}", json={"description": None}
        )

        assert response.status_code == 200
        assert response.json()["description"] is None
        session.refresh(dashboard)
        assert dashboard.description is None
        assert dashboard.name == "Original"

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

    @pytest.mark.parametrize("bad_value", [0, "10", True, 90000])
    def test_create_feed_rejects_bad_interval_sec(self, client: TestClient, bad_value):
        """POST with an invalid interval_sec must fail with 400."""
        response = client.post(
            "/api/feeds",
            json={
                "type": "system_metrics",
                "name": "Bad Interval Feed",
                "config_json": json.dumps({"interval_sec": bad_value}),
                "enabled": True,
            },
        )

        assert response.status_code == 400
        assert (
            "interval_sec must be a number of seconds between 1 and 86400"
            in response.json()["detail"]
        )

    def test_create_feed_accepts_valid_interval_sec(self, client: TestClient):
        """POST with interval_sec 5 must succeed."""
        response = client.post(
            "/api/feeds",
            json={
                "type": "system_metrics",
                "name": "Good Interval Feed",
                "config_json": json.dumps({"interval_sec": 5}),
                "enabled": True,
            },
        )

        assert response.status_code == 201

    def test_update_feed_rejects_bad_interval_sec(
        self, client: TestClient, session: Session
    ):
        """PATCH with an invalid interval_sec must fail and leave config unchanged."""
        original_config = '{"interval_sec": 5}'
        feed = FeedDefinition(
            type="system_metrics", name="Patch Feed", config_json=original_config
        )
        session.add(feed)
        session.commit()
        session.refresh(feed)

        response = client.patch(
            f"/api/feeds/{feed.id}",
            json={"config_json": json.dumps({"interval_sec": 0})},
        )

        assert response.status_code == 400
        assert (
            "interval_sec must be a number of seconds between 1 and 86400"
            in response.json()["detail"]
        )
        session.refresh(feed)
        assert feed.config_json == original_config

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

    @pytest.mark.parametrize("field", ["config_json", "name", "enabled"])
    def test_update_feed_rejects_explicit_null(
        self, client: TestClient, session: Session, field: str
    ):
        """PATCH with an explicit null must fail with 422 and leave the feed unchanged."""
        original_config = '{"interval_sec": 5}'
        feed = FeedDefinition(
            type="system_metrics",
            name="Original",
            config_json=original_config,
            enabled=True,
        )
        session.add(feed)
        session.commit()
        session.refresh(feed)

        response = client.patch(f"/api/feeds/{feed.id}", json={field: None})

        assert response.status_code == 422
        assert response.json()["detail"] == f"{field} cannot be null"
        session.refresh(feed)
        assert feed.config_json == original_config
        assert feed.name == "Original"
        assert feed.enabled is True

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

    @pytest.mark.parametrize("field", ["feed_ids_json", "options_json", "width"])
    def test_update_panel_rejects_explicit_null(
        self, client: TestClient, session: Session, field: str
    ):
        """PATCH with an explicit null must fail with 422 and leave the panel unchanged."""
        dashboard = Dashboard(name="Test Dashboard")
        panel = Panel(type="stat", title="Original", position_x=0, position_y=0)
        dashboard.panels.append(panel)
        session.add(dashboard)
        session.commit()
        session.refresh(panel)
        original_feed_ids = panel.feed_ids_json
        original_options = panel.options_json
        original_width = panel.width

        response = client.patch(
            f"/api/dashboards/{dashboard.id}/panels/{panel.id}",
            json={field: None},
        )

        assert response.status_code == 422
        assert response.json()["detail"] == f"{field} cannot be null"
        session.refresh(panel)
        assert panel.feed_ids_json == original_feed_ids
        assert panel.options_json == original_options
        assert panel.width == original_width
        assert panel.title == "Original"

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

    @pytest.mark.parametrize("bad_value", ["5", '{"a": 1}', "[1]", '["not-a-uuid"]'])
    def test_create_panel_rejects_non_uuid_feed_ids(
        self, client: TestClient, session: Session, bad_value: str
    ):
        """POST with feed_ids_json that is not a list of UUIDs must fail."""
        dashboard = Dashboard(name="Test Dashboard")
        session.add(dashboard)
        session.commit()

        response = client.post(
            f"/api/dashboards/{dashboard.id}/panels",
            json={
                "type": "stat",
                "title": "Bad Feeds",
                "feed_ids_json": bad_value,
                "options_json": "{}",
                "position_x": 0,
                "position_y": 0,
                "width": 4,
                "height": 3,
            },
        )

        assert response.status_code == 400
        assert (
            "feed_ids_json must be a JSON list of feed UUID strings"
            in response.json()["detail"]
        )

    def test_create_panel_accepts_empty_and_uuid_feed_ids(
        self, client: TestClient, session: Session
    ):
        """POST with [] or a real uuid4 string list must succeed."""
        dashboard = Dashboard(name="Test Dashboard")
        session.add(dashboard)
        session.commit()

        for good_value in ("[]", json.dumps([str(uuid4())])):
            response = client.post(
                f"/api/dashboards/{dashboard.id}/panels",
                json={
                    "type": "stat",
                    "title": "Good Feeds",
                    "feed_ids_json": good_value,
                    "options_json": "{}",
                    "position_x": 0,
                    "position_y": 0,
                    "width": 4,
                    "height": 3,
                },
            )

            assert response.status_code == 201

    def test_update_panel_rejects_non_uuid_feed_ids(
        self, client: TestClient, session: Session
    ):
        """PATCH with feed_ids_json [1] must fail and leave the row unchanged."""
        dashboard = Dashboard(name="Test Dashboard")
        panel = Panel(type="stat", title="Original", position_x=0, position_y=0)
        dashboard.panels.append(panel)
        session.add(dashboard)
        session.commit()
        original = panel.feed_ids_json

        response = client.patch(
            f"/api/dashboards/{dashboard.id}/panels/{panel.id}",
            json={"feed_ids_json": "[1]"},
        )

        assert response.status_code == 400
        assert (
            "feed_ids_json must be a JSON list of feed UUID strings"
            in response.json()["detail"]
        )
        session.refresh(panel)
        assert panel.feed_ids_json == original


class FakeFeedManager:
    """Test double recording FeedManager lifecycle calls."""

    def __init__(self):
        self.calls = []

    async def start_feed(self, feed_def):
        self.calls.append(("start", feed_def.id))

    async def stop_feed(self, feed_id):
        self.calls.append(("stop", feed_id))

    async def restart_feed(self, session, feed_id):
        self.calls.append(("restart", feed_id))


class FailingStopFeedManager(FakeFeedManager):
    """Manager whose stop_feed raises, to prove HTTP is unaffected."""

    async def stop_feed(self, feed_id):
        raise RuntimeError("boom")


class TestFeedLifecycle:
    """Feed create/update/delete must drive the running feed manager."""

    def test_create_enabled_feed_starts(self, client: TestClient):
        """POST an enabled feed starts it via the manager."""
        fake = FakeFeedManager()
        app.state.feed_manager = fake
        try:
            response = client.post(
                "/api/feeds",
                json={
                    "type": "system_metrics",
                    "name": "Lifecycle Feed",
                    "config_json": '{"interval_sec": 5}',
                    "enabled": True,
                },
            )

            assert response.status_code == 201
            new_id = UUID(response.json()["id"])
            assert fake.calls == [("start", new_id)]
        finally:
            if hasattr(app.state, "feed_manager"):
                delattr(app.state, "feed_manager")

    def test_create_disabled_feed_no_start(self, client: TestClient):
        """POST a disabled feed must not start anything."""
        fake = FakeFeedManager()
        app.state.feed_manager = fake
        try:
            response = client.post(
                "/api/feeds",
                json={
                    "type": "system_metrics",
                    "name": "Disabled Feed",
                    "config_json": '{"interval_sec": 5}',
                    "enabled": False,
                },
            )

            assert response.status_code == 201
            assert fake.calls == []
        finally:
            if hasattr(app.state, "feed_manager"):
                delattr(app.state, "feed_manager")

    def test_update_feed_restarts(self, client: TestClient, session: Session):
        """PATCH a feed restarts it via the manager."""
        feed = FeedDefinition(type="system_metrics", name="Original", enabled=True)
        session.add(feed)
        session.commit()
        feed_id = feed.id

        fake = FakeFeedManager()
        app.state.feed_manager = fake
        try:
            response = client.patch(
                f"/api/feeds/{feed_id}", json={"name": "Updated"}
            )

            assert response.status_code == 200
            assert fake.calls == [("restart", feed_id)]
        finally:
            if hasattr(app.state, "feed_manager"):
                delattr(app.state, "feed_manager")

    def test_delete_feed_stops(self, client: TestClient, session: Session):
        """DELETE a feed stops it via the manager."""
        feed = FeedDefinition(type="system_metrics", name="To Delete")
        session.add(feed)
        session.commit()
        feed_id = feed.id

        fake = FakeFeedManager()
        app.state.feed_manager = fake
        try:
            response = client.delete(f"/api/feeds/{feed_id}")

            assert response.status_code == 204
            assert fake.calls == [("stop", feed_id)]
        finally:
            if hasattr(app.state, "feed_manager"):
                delattr(app.state, "feed_manager")

    def test_delete_feed_manager_error_still_204(
        self, client: TestClient, session: Session
    ):
        """A manager stop error must not change the DELETE response."""
        feed = FeedDefinition(type="system_metrics", name="To Delete")
        session.add(feed)
        session.commit()
        feed_id = feed.id

        app.state.feed_manager = FailingStopFeedManager()
        try:
            response = client.delete(f"/api/feeds/{feed_id}")

            assert response.status_code == 204
            assert session.get(FeedDefinition, feed_id) is None
        finally:
            if hasattr(app.state, "feed_manager"):
                delattr(app.state, "feed_manager")
