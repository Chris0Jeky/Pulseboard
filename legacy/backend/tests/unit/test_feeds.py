"""
Unit tests for feed implementations.
"""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.feeds.base import BaseFeed
from app.feeds.crypto_price import CryptoPriceFeed
from app.feeds.system_metrics import SystemMetricsFeed
from app.hub.events import FeedEvent


class MockFeed(BaseFeed):
    """Mock feed for testing."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fetch_count = 0

    async def fetch_data(self):
        """Return mock data."""
        self.fetch_count += 1
        return {"value": self.fetch_count}


@pytest.fixture
def mock_hub():
    """Create mock DataHub."""
    hub = MagicMock()
    hub.publish_feed_event = AsyncMock()
    return hub


class TestBaseFeed:
    """Tests for BaseFeed abstract class."""

    async def test_feed_initialization(self, mock_hub):
        """Test feed initialization."""
        feed_id = uuid4()
        config = {"interval_sec": 2}

        feed = MockFeed(feed_id, config, mock_hub)

        assert feed.feed_id == feed_id
        assert feed.config == config
        assert feed.hub == mock_hub
        assert feed.is_running() is False

    async def test_feed_run_publishes_events(self, mock_hub):
        """Test that feed run loop publishes events."""
        feed_id = uuid4()
        config = {"interval_sec": 0.1}  # Fast interval for testing

        feed = MockFeed(feed_id, config, mock_hub)

        # Run feed for a short time
        task = asyncio.create_task(feed.run())
        await asyncio.sleep(0.35)  # Allow for ~3 iterations
        await feed.stop()
        await task

        # Check that events were published
        assert mock_hub.publish_feed_event.call_count >= 2
        mock_hub.publish_feed_event.assert_called_with(feed_id, {"value": 3})

    async def test_feed_start_stop(self, mock_hub):
        """Test starting and stopping a feed."""
        feed_id = uuid4()
        config = {"interval_sec": 0.1}

        feed = MockFeed(feed_id, config, mock_hub)

        # Start feed
        await feed.start()
        assert feed.is_running() is True

        await asyncio.sleep(0.15)

        # Stop feed
        await feed.stop()
        assert feed.is_running() is False

    async def test_feed_handles_fetch_errors(self, mock_hub):
        """Test that feed continues running despite fetch errors."""
        feed_id = uuid4()
        config = {"interval_sec": 0.1}

        class ErrorFeed(BaseFeed):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self.call_count = 0

            async def fetch_data(self):
                self.call_count += 1
                if self.call_count == 1:
                    raise Exception("Test error")
                return {"value": self.call_count}

        feed = ErrorFeed(feed_id, config, mock_hub)

        task = asyncio.create_task(feed.run())
        await asyncio.sleep(0.35)
        await feed.stop()
        await task

        # Feed should have recovered and continued
        assert feed.call_count >= 2

    @pytest.mark.parametrize("bad_value", ["10", 0, -1, True, float("nan")])
    async def test_feed_run_invalid_interval_falls_back_to_default(
        self, mock_hub, monkeypatch, bad_value
    ):
        """Invalid interval_sec values fall back to 5s with an error log."""
        feed_id = uuid4()
        feed = MockFeed(feed_id, {"interval_sec": bad_value}, mock_hub)
        seen = []

        async def fake_sleep(delay):
            seen.append(delay)
            feed._stop_requested = True

        monkeypatch.setattr("app.feeds.base.asyncio.sleep", fake_sleep)
        with patch.object(feed.logger, "error") as mock_error:
            await feed.run()

        assert seen == [5]
        assert mock_error.call_count >= 1

    async def test_feed_run_small_interval_used_as_is(self, mock_hub, monkeypatch):
        """A small but positive interval such as 0.1 is used as-is."""
        feed_id = uuid4()
        feed = MockFeed(feed_id, {"interval_sec": 0.1}, mock_hub)
        seen = []

        async def fake_sleep(delay):
            seen.append(delay)
            feed._stop_requested = True

        monkeypatch.setattr("app.feeds.base.asyncio.sleep", fake_sleep)
        with patch.object(feed.logger, "error") as mock_error:
            await feed.run()

        assert seen == [0.1]
        assert mock_error.call_count == 0


    async def test_feed_run_huge_int_interval_falls_back_to_default(
        self, mock_hub, monkeypatch
    ):
        """An int too large for a float must not raise (asyncio.sleep would): it falls back to 5s."""
        huge = 10**400
        feed_id = uuid4()
        feed = MockFeed(feed_id, {"interval_sec": huge}, mock_hub)
        seen = []

        async def fake_sleep(delay):
            seen.append(delay)
            feed._stop_requested = True

        monkeypatch.setattr("app.feeds.base.asyncio.sleep", fake_sleep)
        with patch.object(feed.logger, "error") as mock_error:
            await feed.run()

        assert seen == [5.0]
        assert mock_error.call_count == 1


class TestSystemMetricsFeed:
    """Tests for SystemMetricsFeed."""

    async def test_fetch_basic_metrics(self, mock_hub):
        """Test fetching basic CPU and memory metrics."""
        feed_id = uuid4()
        config = {"interval_sec": 5}

        feed = SystemMetricsFeed(feed_id, config, mock_hub)
        data = await feed.fetch_data()

        # Check that basic metrics are present
        assert "cpu_percent" in data
        assert "memory_percent" in data
        assert "memory_used_gb" in data
        assert "memory_total_gb" in data

        # Validate metric values
        assert 0 <= data["cpu_percent"] <= 100
        assert 0 <= data["memory_percent"] <= 100
        assert data["memory_used_gb"] > 0
        assert data["memory_total_gb"] > 0

    async def test_fetch_with_disk_metrics(self, mock_hub):
        """Test fetching with disk metrics enabled."""
        feed_id = uuid4()
        config = {"interval_sec": 5, "include_disk": True}

        feed = SystemMetricsFeed(feed_id, config, mock_hub)
        data = await feed.fetch_data()

        # Check that disk metrics are present
        assert "disk_percent" in data
        assert "disk_used_gb" in data
        assert "disk_total_gb" in data

        assert 0 <= data["disk_percent"] <= 100

    async def test_fetch_with_network_metrics(self, mock_hub):
        """Test fetching with network metrics enabled."""
        feed_id = uuid4()
        config = {"interval_sec": 5, "include_network": True}

        feed = SystemMetricsFeed(feed_id, config, mock_hub)
        data = await feed.fetch_data()

        # Check that network metrics are present
        assert "net_bytes_sent" in data
        assert "net_bytes_recv" in data

        assert data["net_bytes_sent"] >= 0
        assert data["net_bytes_recv"] >= 0

    @patch("app.feeds.system_metrics.psutil")
    async def test_fetch_data_mocked(self, mock_psutil, mock_hub):
        """Test fetch_data with mocked psutil."""
        # Mock psutil responses
        mock_psutil.cpu_percent.return_value = 45.5
        mock_psutil.virtual_memory.return_value = MagicMock(
            percent=65.3, used=8 * 1024**3, total=16 * 1024**3
        )

        feed_id = uuid4()
        config = {"interval_sec": 5}

        feed = SystemMetricsFeed(feed_id, config, mock_hub)
        data = await feed.fetch_data()

        assert data["cpu_percent"] == 45.5
        assert data["memory_percent"] == 65.3
        assert data["memory_used_gb"] == 8.0
        assert data["memory_total_gb"] == 16.0


def _coingecko_client(payload, captured_params):
    """Build a fake httpx.AsyncClient context manager serving payload."""
    mock_response = MagicMock()
    mock_response.json.return_value = payload
    mock_response.raise_for_status.return_value = None
    mock_client = AsyncMock()

    async def _fake_get(url, params=None, timeout=None):
        captured_params.update(params or {})
        return mock_response

    mock_client.get.side_effect = _fake_get
    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_client
    mock_cm.__aexit__.return_value = False
    return mock_cm


class TestCryptoPriceFeed:
    """Tests for CryptoPriceFeed currency handling (no network)."""

    async def test_missing_currency_raises(self, mock_hub):
        """Missing currency must raise instead of publishing price 0."""
        feed = CryptoPriceFeed(uuid4(), {"coin_id": "bitcoin"}, mock_hub)
        mock_cm = _coingecko_client({"bitcoin": {"eur": 1.0}}, {})
        with patch(
            "app.feeds.crypto_price.httpx.AsyncClient", return_value=mock_cm
        ):
            with pytest.raises(ValueError, match="Currency usd not found"):
                await feed.fetch_data()

    async def test_uppercase_currency_normalised(self, mock_hub):
        """Uppercase config currency is normalised to lowercase."""
        feed = CryptoPriceFeed(
            uuid4(), {"coin_id": "bitcoin", "vs_currency": "USD"}, mock_hub
        )
        captured_params = {}
        mock_cm = _coingecko_client({"bitcoin": {"usd": 42.0}}, captured_params)
        with patch(
            "app.feeds.crypto_price.httpx.AsyncClient", return_value=mock_cm
        ):
            data = await feed.fetch_data()
        assert data["price"] == 42.0
        assert data["vs_currency"] == "usd"
        assert captured_params["vs_currencies"] == "usd"

    async def test_real_zero_price_published(self, mock_hub):
        """A real upstream zero is published, not treated as missing."""
        feed = CryptoPriceFeed(uuid4(), {"coin_id": "bitcoin"}, mock_hub)
        mock_cm = _coingecko_client({"bitcoin": {"usd": 0}}, {})
        with patch(
            "app.feeds.crypto_price.httpx.AsyncClient", return_value=mock_cm
        ):
            data = await feed.fetch_data()
        assert data["price"] == 0
