"""Feed JSON shapes are rejected before persistence or lifecycle changes (#75)."""

import json
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.models import FeedDefinition
from .test_api import client_fixture, session_fixture  # noqa: F401

NON_OBJECTS = [None, True, 5, "text", [], [{"interval_sec": 1}]]


@pytest.mark.parametrize("config", NON_OBJECTS)
def test_create_rejects_non_object_config(client: TestClient, session: Session, monkeypatch, config):
    manager = AsyncMock()
    monkeypatch.setattr(app.state, "feed_manager", manager, raising=False)

    response = client.post("/api/feeds", json={
        "name": "Rejected", "type": "system_metrics", "config_json": json.dumps(config),
    })

    assert response.status_code == 400
    assert response.json()["detail"] == "config_json must be a JSON object"
    assert session.exec(select(FeedDefinition)).all() == []
    manager.start_feed.assert_not_awaited()


@pytest.mark.parametrize("config", NON_OBJECTS)
def test_patch_rejects_non_object_config_atomically(client: TestClient, session: Session, monkeypatch, config):
    feed = FeedDefinition(name="Keep", type="system_metrics", config_json='{"interval_sec": 10}', enabled=False)
    session.add(feed)
    session.commit()
    session.refresh(feed)
    manager = AsyncMock()
    monkeypatch.setattr(app.state, "feed_manager", manager, raising=False)

    response = client.patch(f"/api/feeds/{feed.id}", json={
        "name": "Must not persist", "enabled": True, "config_json": json.dumps(config),
    })

    assert response.status_code == 400
    assert response.json()["detail"] == "config_json must be a JSON object"
    session.refresh(feed)
    assert feed.name == "Keep"
    assert feed.enabled is False
    assert feed.config_json == '{"interval_sec": 10}'
    manager.restart_feed.assert_not_awaited()


@pytest.mark.parametrize("config", [{}, {"interval_sec": 1}, {"interval_sec": 86400}, {"interval_sec": 1.5}])
def test_object_configs_and_interval_boundaries_remain_accepted(client: TestClient, config):
    response = client.post("/api/feeds", json={
        "name": "Valid", "type": "system_metrics", "config_json": json.dumps(config), "enabled": False,
    })
    assert response.status_code == 201
    feed_id = response.json()["id"]
    response = client.patch(f"/api/feeds/{feed_id}", json={"config_json": json.dumps(config)})
    assert response.status_code == 200
    assert json.loads(response.json()["config_json"]) == config
