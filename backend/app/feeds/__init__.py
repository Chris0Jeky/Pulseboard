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
    "get_feed_class",
]
