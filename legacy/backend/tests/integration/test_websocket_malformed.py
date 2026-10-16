"""
Integration test for malformed (non-object) WebSocket frames.

Non-dict JSON frames must be ignored without tearing down the
connection, so a subsequent ping still receives a pong.
"""

import json

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine
from sqlmodel.pool import StaticPool

from app.db.base import SQLModel
from app.hub.hub import DataHub
from app.main import app
from app.models import Dashboard
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

    ws_router.set_hub(hub)

    app.dependency_overrides[get_session] = get_session_override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


class TestMalformedFrames:
    """Malformed frames must not tear down the connection."""

    def test_non_object_frames_ignored_then_ping_pongs(
        self, client: TestClient, session: Session
    ):
        """Send [], 123, and string frames, then ping; still get pong."""
        dashboard = Dashboard(name="Test Dashboard")
        session.add(dashboard)
        session.commit()

        with client.websocket_connect(
            f"/ws/dashboards/{dashboard.id}"
        ) as websocket:
            websocket.send_text("[]")
            websocket.send_text("123")
            websocket.send_text("null")
            websocket.send_text(json.dumps({"type": 42}))
            websocket.send_text(json.dumps("ping"))
            websocket.send_text(json.dumps({"type": "ping"}))

            async def receive_with_timeout():
                # Bound the receive so a dropped connection fails instead of hanging.
                with anyio.fail_after(2):
                    return await websocket._send_rx.receive()

            response = websocket.portal.call(receive_with_timeout)
            assert response["type"] == "websocket.send"
            assert json.loads(response["text"])["type"] == "pong"
