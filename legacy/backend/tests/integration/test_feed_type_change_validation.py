"""Type-change PATCH must validate merged config against the new type."""

import json
from uuid import UUID

import pytest
from app.models import FeedDefinition
from fastapi.testclient import TestClient
from sqlmodel import Session

from .test_api import client_fixture, session_fixture  # noqa: F401


def test_patch_type_change_without_compatible_config_rejected(
    client: TestClient, session: Session
):
    create_response = client.post(
        "/api/feeds",
        json={
            "type": "crypto_price",
            "name": "Crypto Feed",
            "config_json": json.dumps({"coin_id": "bitcoin"}),
            "enabled": False,
        },
    )
    assert create_response.status_code == 201
    feed_id = create_response.json()["id"]
    original_config = json.dumps({"coin_id": "bitcoin"})

    patch_response = client.patch(
        f"/api/feeds/{feed_id}",
        json={"type": "http_json"},
    )

    assert patch_response.status_code == 400
    stored = session.get(FeedDefinition, UUID(feed_id))
    assert stored is not None
    assert stored.type == "crypto_price"
    assert json.loads(stored.config_json) == json.loads(original_config)


def test_patch_type_change_with_compatible_config_accepted(
    client: TestClient, session: Session
):
    create_response = client.post(
        "/api/feeds",
        json={
            "type": "crypto_price",
            "name": "Crypto Feed",
            "config_json": json.dumps({"coin_id": "bitcoin"}),
            "enabled": False,
        },
    )
    assert create_response.status_code == 201
    feed_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/feeds/{feed_id}",
        json={
            "type": "http_json",
            "config_json": json.dumps({"url": "https://example.com/data"}),
        },
    )

    assert patch_response.status_code == 200
    assert patch_response.json()["type"] == "http_json"
    stored = session.get(FeedDefinition, UUID(feed_id))
    assert stored is not None
    assert stored.type == "http_json"
    assert json.loads(stored.config_json) == {"url": "https://example.com/data"}


def test_patch_type_change_uses_compatible_stored_config(client: TestClient):
    config = {"url": "https://example.com/data"}
    created = client.post("/api/feeds", json={
        "type": "system_metrics", "name": "Stored config",
        "config_json": json.dumps(config), "enabled": False,
    })
    assert created.status_code == 201
    response = client.patch(f"/api/feeds/{created.json()['id']}", json={"type": "http_json"})
    assert response.status_code == 200
    assert json.loads(response.json()["config_json"]) == config


def test_patch_type_change_rejects_crypto_default_config(client: TestClient):
    created = client.post("/api/feeds", json={
        "type": "system_metrics", "name": "Default config", "enabled": False,
    })
    assert created.status_code == 201
    response = client.patch(f"/api/feeds/{created.json()['id']}", json={"type": "crypto_price"})
    assert response.status_code == 400


@pytest.mark.parametrize("config", [{}, {"coin_id": ""}, {"coin_id": "  "}, {"coin_id": 42}, {"coin_id": None}])
@pytest.mark.parametrize("operation", ["create", "type_change"])
def test_crypto_config_requires_nonempty_coin_id(client: TestClient, config, operation):
    payload = {"type": "crypto_price", "config_json": json.dumps(config), "enabled": False}
    if operation == "create":
        response = client.post("/api/feeds", json={**payload, "name": "Crypto"})
    else:
        created = client.post("/api/feeds", json={
            "type": "system_metrics", "name": "System", "enabled": False,
        })
        assert created.status_code == 201
        response = client.patch(f"/api/feeds/{created.json()['id']}", json=payload)
    assert response.status_code == 400
    assert response.json()["detail"] == "coin_id is required and must be a non-empty string"


def test_patch_type_change_accepts_crypto_coin_id(client: TestClient):
    created = client.post("/api/feeds", json={
        "type": "system_metrics", "name": "System", "enabled": False,
    })
    assert created.status_code == 201
    response = client.patch(f"/api/feeds/{created.json()['id']}", json={
        "type": "crypto_price", "config_json": json.dumps({"coin_id": "bitcoin"}),
    })
    assert response.status_code == 200
