"""
Feeds package with registry of available feed types.
"""

from typing import Dict, Type

from .base import BaseFeed
from .system_metrics import SystemMetricsFeed

# Registry of feed types
FEED_TYPES: Dict[str, Type[BaseFeed]] = {
    "system_metrics": SystemMetricsFeed,
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


__all__ = ["BaseFeed", "SystemMetricsFeed", "FEED_TYPES", "get_feed_class"]
