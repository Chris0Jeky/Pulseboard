"""
Unit tests for database models.
"""

from uuid import UUID

import pytest
from pydantic import ValidationError
from sqlmodel import Session, create_engine, select

from app.db.base import SQLModel
from app.models import (
    Dashboard,
    DashboardCreate,
    DashboardUpdate,
    FeedCreate,
    FeedDefinition,
    FeedUpdate,
    Panel,
    PanelCreate,
    PanelUpdate,
)


@pytest.fixture
def memory_db():
    """Create in-memory SQLite database for testing."""
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    SQLModel.metadata.drop_all(engine)


class TestDashboardModel:
    """Tests for Dashboard model."""

    def test_create_dashboard(self, memory_db: Session):
        """Test creating a dashboard."""
        dashboard = Dashboard(name="Test Dashboard", description="Test Description")
        memory_db.add(dashboard)
        memory_db.commit()
        memory_db.refresh(dashboard)

        assert dashboard.id is not None
        assert isinstance(dashboard.id, UUID)
        assert dashboard.name == "Test Dashboard"
        assert dashboard.description == "Test Description"
        assert dashboard.layout_json == "{}"
        assert dashboard.created_at is not None
        assert dashboard.updated_at is not None

    def test_dashboard_create_schema(self):
        """Test DashboardCreate schema."""
        data = DashboardCreate(name="Test", description="Desc")
        assert data.name == "Test"
        assert data.description == "Desc"

    def test_dashboard_create_validation(self):
        """Test DashboardCreate validation."""
        # Name is required
        with pytest.raises(ValidationError):
            DashboardCreate()

        # Name cannot be empty
        with pytest.raises(ValidationError):
            DashboardCreate(name="")

    def test_dashboard_update_schema(self):
        """Test DashboardUpdate schema."""
        data = DashboardUpdate(name="Updated")
        assert data.name == "Updated"
        assert data.description is None

    def test_dashboard_with_panels(self, memory_db: Session):
        """Test dashboard with panels relationship."""
        dashboard = Dashboard(name="Dashboard with Panels")
        panel = Panel(
            dashboard_id=None,  # Will be set by relationship
            type="timeseries",
            title="Test Panel",
            position_x=0,
            position_y=0,
        )
        dashboard.panels.append(panel)

        memory_db.add(dashboard)
        memory_db.commit()
        memory_db.refresh(dashboard)

        assert len(dashboard.panels) == 1
        assert dashboard.panels[0].title == "Test Panel"
        assert dashboard.panels[0].dashboard_id == dashboard.id


class TestFeedModel:
    """Tests for FeedDefinition model."""

    def test_create_feed(self, memory_db: Session):
        """Test creating a feed definition."""
        feed = FeedDefinition(
            type="system_metrics", name="System Metrics", config_json='{"interval": 5}'
        )
        memory_db.add(feed)
        memory_db.commit()
        memory_db.refresh(feed)

        assert feed.id is not None
        assert isinstance(feed.id, UUID)
        assert feed.type == "system_metrics"
        assert feed.name == "System Metrics"
        assert feed.config_json == '{"interval": 5}'
        assert feed.enabled is True
        assert feed.created_at is not None
        assert feed.updated_at is not None

    def test_feed_create_schema(self):
        """Test FeedCreate schema."""
        data = FeedCreate(type="http_json", name="Test Feed")
        assert data.type == "http_json"
        assert data.name == "Test Feed"
        assert data.enabled is True

    def test_feed_create_validation(self):
        """Test FeedCreate validation."""
        # Type and name are required
        with pytest.raises(ValidationError):
            FeedCreate()

        with pytest.raises(ValidationError):
            FeedCreate(type="test")

    def test_feed_update_schema(self):
        """Test FeedUpdate schema."""
        data = FeedUpdate(enabled=False)
        assert data.enabled is False
        assert data.type is None

    def test_feed_enabled_filtering(self, memory_db: Session):
        """Test filtering feeds by enabled status."""
        feed1 = FeedDefinition(type="test1", name="Enabled Feed", enabled=True)
        feed2 = FeedDefinition(type="test2", name="Disabled Feed", enabled=False)

        memory_db.add(feed1)
        memory_db.add(feed2)
        memory_db.commit()

        # Query only enabled feeds
        enabled_feeds = memory_db.exec(
            select(FeedDefinition).where(FeedDefinition.enabled == True)  # noqa: E712
        ).all()

        assert len(enabled_feeds) == 1
        assert enabled_feeds[0].name == "Enabled Feed"


class TestPanelModel:
    """Tests for Panel model."""

    def test_create_panel(self, memory_db: Session):
        """Test creating a panel."""
        dashboard = Dashboard(name="Test Dashboard")
        memory_db.add(dashboard)
        memory_db.commit()
        memory_db.refresh(dashboard)

        panel = Panel(
            dashboard_id=dashboard.id,
            type="stat",
            title="CPU Usage",
            feed_ids_json='["feed-1"]',
            position_x=0,
            position_y=0,
            width=4,
            height=3,
        )
        memory_db.add(panel)
        memory_db.commit()
        memory_db.refresh(panel)

        assert panel.id is not None
        assert panel.dashboard_id == dashboard.id
        assert panel.type == "stat"
        assert panel.title == "CPU Usage"
        assert panel.width == 4
        assert panel.height == 3

    def test_panel_create_schema(self):
        """Test PanelCreate schema."""
        data = PanelCreate(type="timeseries", title="Test Panel")
        assert data.type == "timeseries"
        assert data.title == "Test Panel"
        assert data.position_x == 0
        assert data.position_y == 0
        assert data.width == 4
        assert data.height == 4

    def test_panel_create_validation(self):
        """Test PanelCreate validation."""
        # Type and title are required
        with pytest.raises(ValidationError):
            PanelCreate()

        # Width and height must be within valid range
        with pytest.raises(ValidationError):
            PanelCreate(type="stat", title="Test", width=13)

        with pytest.raises(ValidationError):
            PanelCreate(type="stat", title="Test", width=0)

    def test_panel_update_schema(self):
        """Test PanelUpdate schema."""
        data = PanelUpdate(title="Updated Title", width=6)
        assert data.title == "Updated Title"
        assert data.width == 6
        assert data.type is None

    def test_panel_cascade_delete(self, memory_db: Session):
        """Test that deleting a dashboard deletes its panels."""
        dashboard = Dashboard(name="Dashboard to Delete")
        panel = Panel(type="stat", title="Panel to Delete", position_x=0, position_y=0)
        dashboard.panels.append(panel)

        memory_db.add(dashboard)
        memory_db.commit()

        dashboard_id = dashboard.id

        # Delete dashboard
        memory_db.delete(dashboard)
        memory_db.commit()

        # Verify panels are deleted
        panels = memory_db.exec(
            select(Panel).where(Panel.dashboard_id == dashboard_id)
        ).all()
        assert len(panels) == 0
