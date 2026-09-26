"""
HTTP JSON feed for polling generic JSON APIs.
"""

from typing import Any, Dict

import httpx

from .base import BaseFeed


class HttpJsonFeed(BaseFeed):
    """
    Feed that polls a JSON HTTP endpoint.

    Config options:
        - url: HTTP(S) URL to fetch (required)
        - interval_sec: How often to fetch (default: 60)
        - method: HTTP method (default: GET)
        - headers: Optional headers dict
        - timeout: Request timeout in seconds (default: 10)
    """

    async def fetch_data(self) -> Dict[str, Any]:
        """
        Fetch data from HTTP endpoint.

        Returns:
            JSON response as dict
        """
        url = self.config.get("url")
        if not url:
            raise ValueError("url is required in config")

        method = self.config.get("method", "GET").upper()
        headers = self.config.get("headers", {})
        timeout = self.config.get("timeout", 10)

        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=method,
                url=url,
                headers=headers,
                timeout=timeout,
            )

            response.raise_for_status()
            data = response.json()

            # Extract specific path if configured
            path = self.config.get("path")
            if path:
                # Simple dot notation path support (e.g., "data.metrics.cpu")
                parts = path.split(".")
                for part in parts:
                    if isinstance(data, dict):
                        data = data.get(part, {})
                    else:
                        break

            # Ensure we return a dict
            if not isinstance(data, dict):
                return {"value": data}

            return data
