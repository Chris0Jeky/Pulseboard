"""Use the assembled application, real lifespan, and one session per request."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app import main
from app.db import base as db_base
from app.db import session as db_session
from app.models import Dashboard
from app.ws import router as ws_router


@pytest.fixture
def production_runtime(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'production-revocation.sqlite'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        dashboard = Dashboard(name="Production wiring")
        session.add(dashboard)
        session.commit()
        dashboard_id = dashboard.id
    # Redirect only persistence, not the hub or dependency wiring. The actual
    # lifespan creates the hub and the actual get_session opens each session.
    monkeypatch.setattr(db_base, "engine", engine)
    monkeypatch.setattr(db_session, "engine", engine)
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "hub", None)
    monkeypatch.setattr(main, "feed_manager", None)
    monkeypatch.setattr(ws_router, "_hub", None)
    monkeypatch.setattr(main.app, "dependency_overrides", {})
    try:
        with TestClient(main.app) as client:
            assert main.app.state.hub is ws_router.get_hub()
            yield client, engine, main.app.state.hub, dashboard_id
        assert main.app.state.hub is None
    finally:
        engine.dispose()


@pytest.mark.parametrize("via_http", [True, False])
def test_real_lifespan_revokes_socket_with_distinct_database_sessions(production_runtime, via_http):
    client, engine, hub, dashboard_id = production_runtime
    with client.websocket_connect(f"/ws/dashboards/{dashboard_id}") as socket:
        socket.send_json({"type": "ping"})
        assert socket.receive_json() == {"type": "pong"}
        if via_http:
            assert client.delete(f"/api/dashboards/{dashboard_id}").status_code == 204
            assert dashboard_id not in hub.connections
        else:
            with Session(engine) as writer:
                writer.delete(writer.get(Dashboard, dashboard_id))
                writer.commit()
            socket.send_json({"type": "ping"})
        message = socket.receive()
        assert message["type"] == "websocket.close", "expired ORM identities must not keep receiving pong"
        assert message["code"] == 1008
        assert dashboard_id not in hub.connections
        assert dashboard_id not in hub.dashboard_feeds


async def test_independent_session_deletion_during_handshake_closes(production_runtime):
    _client, engine, hub, dashboard_id = production_runtime
    socket = AsyncMock()

    async def delete_during_accept():
        with Session(engine) as writer:
            writer.delete(writer.get(Dashboard, dashboard_id))
            writer.commit()

    socket.accept.side_effect = delete_during_accept
    socket.receive_text.side_effect = RuntimeError("stale handshake entered receive loop")
    with Session(engine) as reader:
        await ws_router.websocket_dashboard(socket, dashboard_id, reader, hub)
    socket.close.assert_awaited_once_with(code=1008)
    socket.receive_text.assert_not_awaited()
    assert dashboard_id not in hub.connections


@pytest.mark.parametrize("lookup_number", [2, 3])
async def test_expired_identity_error_closes_before_initial_state_or_pong(production_runtime, monkeypatch, lookup_number):
    from fastapi import WebSocketDisconnect
    from sqlalchemy import inspect
    from sqlalchemy.orm.exc import ObjectDeletedError

    _client, engine, hub, dashboard_id = production_runtime
    socket = AsyncMock()
    socket.receive_text.side_effect = ['{"type":"ping"}', WebSocketDisconnect()]
    with Session(engine) as reader:
        dashboard = reader.get(Dashboard, dashboard_id)
        error = ObjectDeletedError(inspect(dashboard))
        real_get, calls = reader.get, 0

        def expired_get(model, identity):
            nonlocal calls
            calls += 1
            if calls == lookup_number:
                raise error
            return real_get(model, identity)

        monkeypatch.setattr(reader, "get", expired_get)
        await ws_router.websocket_dashboard(socket, dashboard_id, reader, hub)
    socket.close.assert_awaited_once_with(code=1008)
    socket.send_text.assert_not_awaited()
    assert dashboard_id not in hub.connections
