"""Real HTTP deletion and WebSocket revocation against an isolated SQLite DB."""

import json
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.api.deps import get_session
from app.api.routes import dashboards
from app.hub.hub import DataHub
from app.models import Dashboard, Panel
from app.ws import router as ws_router


@pytest.fixture
def runtime():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    hub, app = DataHub(), FastAPI()
    app.state.hub = hub
    app.include_router(dashboards.router, prefix="/api")
    app.include_router(ws_router.router)
    app.dependency_overrides[ws_router.get_hub] = lambda: hub
    with Session(engine) as session:
        app.dependency_overrides[get_session] = lambda: session
        dashboard = Dashboard(name="Deleted dashboard")
        dashboard.panels.append(Panel(type="stat", title="Feed", feed_ids_json=json.dumps([str(uuid4())])))
        session.add(dashboard)
        session.commit()
        dashboard_id = dashboard.id
        with TestClient(app) as client:
            yield client, session, hub, dashboard_id
    engine.dispose()


def test_http_delete_closes_socket_without_waiting_for_ping(runtime):
    client, _session, hub, dashboard_id = runtime
    with client.websocket_connect(f"/ws/dashboards/{dashboard_id}") as socket:
        socket.send_json({"type": "ping"})
        assert socket.receive_json() == {"type": "pong"}
        assert client.delete(f"/api/dashboards/{dashboard_id}").status_code == 204
        assert dashboard_id not in hub.connections
        assert dashboard_id not in hub.dashboard_feeds
        assert socket.receive() == {"type": "websocket.close", "code": 1008, "reason": ""}


def test_ping_closes_dashboard_deleted_outside_http_route(runtime):
    client, session, hub, dashboard_id = runtime
    with client.websocket_connect(f"/ws/dashboards/{dashboard_id}") as socket:
        socket.send_json({"type": "ping"})
        assert socket.receive_json() == {"type": "pong"}
        session.delete(session.get(Dashboard, dashboard_id))
        session.commit()
        socket.send_json({"type": "ping"})
        message = socket.receive()
        assert message["type"] == "websocket.close", "deleted dashboard must not receive a normal pong"
        assert message["code"] == 1008
        assert dashboard_id not in hub.connections


async def test_deletion_during_handshake_cannot_register_stale_dashboard(runtime):
    _client, session, hub, dashboard_id = runtime
    socket = AsyncMock()

    async def delete_during_accept():
        session.delete(session.get(Dashboard, dashboard_id))
        session.commit()

    socket.accept.side_effect = delete_during_accept
    # A missing-row path must return before entering the normal receive loop.
    socket.receive_text.side_effect = RuntimeError("stale dashboard entered receive loop")
    await ws_router.websocket_dashboard(socket, dashboard_id, session, hub)
    socket.close.assert_awaited_once_with(code=1008)
    socket.receive_text.assert_not_awaited()
    assert dashboard_id not in hub.connections
