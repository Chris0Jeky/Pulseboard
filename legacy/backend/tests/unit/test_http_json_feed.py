"""
Unit tests for HttpJsonFeed and the feed test endpoint.

No network is used: the httpx.AsyncClient used by HttpJsonFeed is
replaced with a fake, and the POST /api/feeds/{id}/test endpoint tests
monkeypatch HttpJsonFeed.fetch_data.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from app.api.deps import get_session
from app.db.base import SQLModel
from app.feeds.http_json import HttpJsonFeed
from app.main import app
from app.models import FeedDefinition
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine
from sqlmodel.pool import StaticPool


@pytest.fixture
def mock_hub():
    """Create mock DataHub."""
    hub = MagicMock()
    hub.publish_feed_event = AsyncMock()
    return hub


def _http_json_client(payload, captured, *, error=None):
    """Build a fake httpx.AsyncClient context manager serving payload."""
    mock_response = MagicMock()
    mock_response.json.return_value = payload
    if error is not None:
        mock_response.raise_for_status.side_effect = error
    else:
        mock_response.raise_for_status.return_value = None
    mock_client = AsyncMock()

    async def _fake_request(method=None, url=None, headers=None, timeout=None):
        captured.update(
            {"method": method, "url": url, "headers": headers, "timeout": timeout}
        )
        return mock_response

    mock_client.request.side_effect = _fake_request
    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_client
    mock_cm.__aexit__.return_value = False
    return mock_cm, mock_client


class TestHttpJsonFeed:
    """Tests for HttpJsonFeed.fetch_data (no network)."""

    async def test_missing_url_raises_value_error(self, mock_hub):
        """Missing url must raise ValueError with the exact message."""
        feed = HttpJsonFeed(uuid4(), {}, mock_hub)
        with pytest.raises(ValueError, match="url is required in config"):
            await feed.fetch_data()

    async def test_empty_url_raises_value_error(self, mock_hub):
        """Empty-string url is falsy and must raise the same ValueError."""
        feed = HttpJsonFeed(uuid4(), {"url": ""}, mock_hub)
        with pytest.raises(ValueError, match="url is required in config"):
            await feed.fetch_data()

    async def test_method_defaults_to_get(self, mock_hub):
        """No method configured must send GET."""
        captured = {}
        mock_cm, mock_client = _http_json_client({"a": 1}, captured)
        feed = HttpJsonFeed(uuid4(), {"url": "https://example.com/data"}, mock_hub)
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            data = await feed.fetch_data()
        assert captured["method"] == "GET"
        assert mock_client.request.call_count == 1
        assert data == {"a": 1}

    async def test_method_is_uppercased(self, mock_hub):
        """Lowercase method config must be upper-cased before sending."""
        captured = {}
        mock_cm, _ = _http_json_client({"a": 1}, captured)
        feed = HttpJsonFeed(
            uuid4(),
            {"url": "https://example.com/data", "method": "post"},
            mock_hub,
        )
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            await feed.fetch_data()
        assert captured["method"] == "POST"

    async def test_headers_and_timeout_passed_through(self, mock_hub):
        """Configured headers and timeout must reach the HTTP request."""
        captured = {}
        mock_cm, _ = _http_json_client({"a": 1}, captured)
        feed = HttpJsonFeed(
            uuid4(),
            {
                "url": "https://example.com/data",
                "headers": {"Authorization": "Bearer token"},
                "timeout": 3,
            },
            mock_hub,
        )
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            await feed.fetch_data()
        assert captured["url"] == "https://example.com/data"
        assert captured["headers"] == {"Authorization": "Bearer token"}
        assert captured["timeout"] == 3

    async def test_headers_timeout_defaults(self, mock_hub):
        """No headers/timeout configured must send {} and 10."""
        captured = {}
        mock_cm, _ = _http_json_client({"a": 1}, captured)
        feed = HttpJsonFeed(uuid4(), {"url": "https://example.com/data"}, mock_hub)
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            await feed.fetch_data()
        assert captured["headers"] == {}
        assert captured["timeout"] == 10

    async def test_raise_for_status_errors_propagate(self, mock_hub):
        """HTTP status errors must propagate instead of being swallowed."""
        captured = {}
        mock_cm, _ = _http_json_client(
            {"a": 1}, captured, error=RuntimeError("upstream 500")
        )
        feed = HttpJsonFeed(uuid4(), {"url": "https://example.com/data"}, mock_hub)
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            with pytest.raises(RuntimeError, match="upstream 500"):
                await feed.fetch_data()

    async def test_dict_body_returned_as_is(self, mock_hub):
        """A dict JSON body without path config is returned unchanged."""
        captured = {}
        mock_cm, _ = _http_json_client({"a": 1, "b": 2}, captured)
        feed = HttpJsonFeed(uuid4(), {"url": "https://example.com/data"}, mock_hub)
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            assert await feed.fetch_data() == {"a": 1, "b": 2}

    async def test_dot_notation_path_extracts_nested_dict(self, mock_hub):
        """A dot-notation path must extract the nested dict value."""
        captured = {}
        payload = {"data": {"metrics": {"cpu": 7}}}
        mock_cm, _ = _http_json_client(payload, captured)
        feed = HttpJsonFeed(
            uuid4(),
            {"url": "https://example.com/data", "path": "data.metrics"},
            mock_hub,
        )
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            assert await feed.fetch_data() == {"cpu": 7}

    async def test_dot_notation_path_scalar_wrapped(self, mock_hub):
        """A path selecting a scalar must wrap it as {"value": ...}."""
        captured = {}
        payload = {"data": {"metrics": {"cpu": 7}}}
        mock_cm, _ = _http_json_client(payload, captured)
        feed = HttpJsonFeed(
            uuid4(),
            {"url": "https://example.com/data", "path": "data.metrics.cpu"},
            mock_hub,
        )
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            assert await feed.fetch_data() == {"value": 7}

    async def test_path_missing_key_returns_empty_dict(self, mock_hub):
        """A path with a missing key resolves to {} instead of raising."""
        captured = {}
        mock_cm, _ = _http_json_client({"data": {"metrics": {}}}, captured)
        feed = HttpJsonFeed(
            uuid4(),
            {"url": "https://example.com/data", "path": "data.absent"},
            mock_hub,
        )
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            assert await feed.fetch_data() == {}

    async def test_path_through_non_dict_stops(self, mock_hub):
        """A path crossing a non-dict value stops and wraps the value."""
        captured = {}
        mock_cm, _ = _http_json_client({"a": [1, 2]}, captured)
        feed = HttpJsonFeed(
            uuid4(), {"url": "https://example.com/data", "path": "a.b"}, mock_hub
        )
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            assert await feed.fetch_data() == {"value": [1, 2]}

    async def test_non_dict_body_wrapped(self, mock_hub):
        """A list JSON body must be wrapped as {"value": [...]}."""
        captured = {}
        mock_cm, _ = _http_json_client([1, 2], captured)
        feed = HttpJsonFeed(uuid4(), {"url": "https://example.com/data"}, mock_hub)
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            assert await feed.fetch_data() == {"value": [1, 2]}

    async def test_scalar_body_wrapped(self, mock_hub):
        """A scalar JSON body must be wrapped as {"value": ...}."""
        captured = {}
        mock_cm, _ = _http_json_client(42, captured)
        feed = HttpJsonFeed(uuid4(), {"url": "https://example.com/data"}, mock_hub)
        with patch(
            "app.feeds.http_json.httpx.AsyncClient", return_value=mock_cm
        ):
            assert await feed.fetch_data() == {"value": 42}


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


class TestFeedTestEndpoint:
    """Tests for POST /api/feeds/{feed_id}/test."""

    def test_unknown_id_returns_404(self, client: TestClient):
        """Testing an unknown feed id must return 404 Feed not found."""
        response = client.post(f"/api/feeds/{uuid4()}/test")

        assert response.status_code == 404
        assert response.json()["detail"] == "Feed not found"

    def test_success_envelope(
        self, client: TestClient, session: Session, monkeypatch
    ):
        """A successful fetch must return {success: true, data, timestamp}."""
        feed = FeedDefinition(
            type="http_json",
            name="JSON Feed",
            config_json='{"url": "https://example.com/data"}',
        )
        session.add(feed)
        session.commit()

        async def fake_fetch_data(self):
            return {"cpu": 1}

        monkeypatch.setattr(HttpJsonFeed, "fetch_data", fake_fetch_data)

        response = client.post(f"/api/feeds/{feed.id}/test")

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"] == {"cpu": 1}
        assert body["error"] is None
        assert datetime.fromisoformat(body["timestamp"]) <= datetime.now(
            datetime.fromisoformat(body["timestamp"]).tzinfo
        )

    def test_failure_envelope_on_fetch_error(
        self, client: TestClient, session: Session, monkeypatch
    ):
        """A failing fetch must return HTTP 200 with {success: false, error}."""
        feed = FeedDefinition(
            type="http_json",
            name="JSON Feed",
            config_json='{"url": "https://example.com/data"}',
        )
        session.add(feed)
        session.commit()

        async def fake_fetch_data(self):
            raise RuntimeError("boom-upstream")

        monkeypatch.setattr(HttpJsonFeed, "fetch_data", fake_fetch_data)

        response = client.post(f"/api/feeds/{feed.id}/test")

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is False
        assert body["data"] is None
        assert body["error"] == "boom-upstream"
        assert datetime.fromisoformat(body["timestamp"]) <= datetime.now(
            datetime.fromisoformat(body["timestamp"]).tzinfo
        )
