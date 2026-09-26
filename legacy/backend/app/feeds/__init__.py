"""
Feeds package with registry of available feed types.
"""

from typing import Dict, Type

from .base import BaseFeed
from .crypto_price import CryptoPriceFeed
from .http_json import HttpJsonFeed
from .system_metrics import SystemMetricsFeed

# Registry of feed types
FEED_TYPES: Dict[str, Type[BaseFeed]] = {
    "system_metrics": SystemMetricsFeed,
    "http_json": HttpJsonFeed,
    "crypto_price": CryptoPriceFeed,
}

# Metadata for feed types used by API and UI
FEED_METADATA: Dict[str, dict] = {
    "system_metrics": {
        "name": "System Metrics",
        "description": "Collect CPU, memory, disk, and network metrics from the host system.",
        "default_config": {
            "interval_sec": 5,
            "include_disk": False,
            "include_network": False,
        },
    },
    "http_json": {
        "name": "HTTP JSON",
        "description": "Poll a JSON HTTP endpoint and publish the response payload.",
        "default_config": {
            "url": "https://api.example.com/data",
            "interval_sec": 60,
            "method": "GET",
        },
    },
    "crypto_price": {
        "name": "Crypto Price",
        "description": "Fetch cryptocurrency spot prices from CoinGecko.",
        "default_config": {
            "coin_id": "bitcoin",
            "vs_currency": "usd",
            "interval_sec": 30,
        },
    },
}


def get_feed_class(feed_type: str) -> Type[BaseFeed] | None:
    """
    Get feed class by type name.

    Args:
        feed_type: Feed type identifier

    Returns:
        Feed class or None if not found
    """
    return FEED_TYPES.get(feed_type)


__all__ = [
    "BaseFeed",
    "SystemMetricsFeed",
    "HttpJsonFeed",
    "CryptoPriceFeed",
    "FEED_TYPES",
    "FEED_METADATA",
    "get_feed_class",
]
