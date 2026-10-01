"""
Tests for pruning deleted feed UUIDs from panels on DELETE /api/feeds/{id}.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine
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


class TestFeedDeletePrunesPanelRefs:
    """DELETE /api/feeds/{id} must prune the deleted id from panels."""

    def test_delete_feed_prunes_panel_refs(
        self, client: TestClient, session: Session
    ):
        """Referencing panel loses the deleted id; unrelated ids/panels kept."""
        feed = FeedDefinition(type="system_metrics", name="To Delete")
        other = FeedDefinition(type="system_metrics", name="Other")
        session.add(feed)
        session.add(other)
        session.commit()
        session.refresh(feed)
        session.refresh(other)
        feed_id_str = str(feed.id)
        other_id_str = str(other.id)

        dashboard = Dashboard(name="Test Dashboard")
        panel = Panel(
            type="stat",
            title="Referencing",
            feed_ids_json=json.dumps([feed_id_str, other_id_str]),
            position_x=0,
            position_y=0,
        )
        unrelated = Panel(
            type="stat",
            title="Unrelated",
            feed_ids_json=json.dumps([other_id_str]),
            position_x=0,
            position_y=0,
        )
        dashboard.panels.append(panel)
        dashboard.panels.append(unrelated)
        session.add(dashboard)
        session.commit()
        session.refresh(panel)
        session.refresh(unrelated)

        response = client.delete(f"/api/feeds/{feed.id}")

        assert response.status_code == 204
        assert session.get(FeedDefinition, feed.id) is None

        session.refresh(panel)
        session.refresh(unrelated)
        assert feed_id_str not in json.loads(panel.feed_ids_json)
        assert other_id_str in json.loads(panel.feed_ids_json)
        assert json.loads(unrelated.feed_ids_json) == [other_id_str]

    def test_delete_unreferenced_feed_still_204(
        self, client: TestClient, session: Session
    ):
        """Deleting a feed no panel references must still return 204."""
        feed = FeedDefinition(type="system_metrics", name="Lonely")
        session.add(feed)
        session.commit()
        session.refresh(feed)

        response = client.delete(f"/api/feeds/{feed.id}")

        assert response.status_code == 204
        assert session.get(FeedDefinition, feed.id) is None
