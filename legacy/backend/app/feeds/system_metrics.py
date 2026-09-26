"""
System metrics feed using psutil.
"""

from typing import Any, Dict

import psutil

from .base import BaseFeed


class SystemMetricsFeed(BaseFeed):
    """
    Feed that reports system metrics (CPU, RAM, etc.).

    Config options:
        - interval_sec: How often to fetch metrics (default: 5)
        - include_disk: Whether to include disk usage (default: False)
        - include_network: Whether to include network stats (default: False)
    """

    async def fetch_data(self) -> Dict[str, Any]:
        """
        Fetch system metrics using psutil.

        Returns:
            Dict with CPU, RAM, and optionally disk/network metrics
        """
        payload: Dict[str, Any] = {}

        # CPU percentage (non-blocking)
        payload["cpu_percent"] = psutil.cpu_percent(interval=0.1)

        # Memory usage
        memory = psutil.virtual_memory()
        payload["memory_percent"] = memory.percent
        payload["memory_used_gb"] = round(memory.used / (1024**3), 2)
        payload["memory_total_gb"] = round(memory.total / (1024**3), 2)

        # Optional: Disk usage
        if self.config.get("include_disk", False):
            disk = psutil.disk_usage("/")
            payload["disk_percent"] = disk.percent
            payload["disk_used_gb"] = round(disk.used / (1024**3), 2)
            payload["disk_total_gb"] = round(disk.total / (1024**3), 2)

        # Optional: Network stats
        if self.config.get("include_network", False):
            net = psutil.net_io_counters()
            payload["net_bytes_sent"] = net.bytes_sent
            payload["net_bytes_recv"] = net.bytes_recv

        return payload
