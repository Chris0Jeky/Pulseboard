"""
Unit tests for feed implementations.
"""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.feeds.base import BaseFeed
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
