"""
Cryptocurrency price feed using a public API.
"""

from typing import Any, Dict

import httpx

from .base import BaseFeed


class CryptoPriceFeed(BaseFeed):
    """
    Feed that fetches cryptocurrency prices.

    Uses CoinGecko API (no API key required for basic usage).

    Config options:
        - coin_id: CoinGecko coin ID (e.g., "bitcoin", "ethereum") (required)
        - vs_currency: Currency to compare against (default: "usd")
        - interval_sec: How often to fetch (default: 60)
        - include_market_data: Include market cap, volume, etc. (default: False)
    """

    COINGECKO_API = "https://api.coingecko.com/api/v3"

    async def fetch_data(self) -> Dict[str, Any]:
        """
        Fetch cryptocurrency price data.

        Returns:
            Dict with price and optional market data
        """
        coin_id = self.config.get("coin_id")
        if not coin_id:
            raise ValueError("coin_id is required in config")

        vs_currency = self.config.get("vs_currency", "usd")
        include_market_data = self.config.get("include_market_data", False)

        # Simple price endpoint
        url = f"{self.COINGECKO_API}/simple/price"
        params = {
            "ids": coin_id,
            "vs_currencies": vs_currency,
        }

        if include_market_data:
            params["include_market_cap"] = "true"
            params["include_24hr_vol"] = "true"
            params["include_24hr_change"] = "true"

        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            if coin_id not in data:
                raise ValueError(f"Coin {coin_id} not found in response")

            coin_data = data[coin_id]

            # Structure the response
            result: Dict[str, Any] = {
                "coin_id": coin_id,
                "vs_currency": vs_currency,
                "price": coin_data.get(vs_currency, 0),
            }

            if include_market_data:
                result["market_cap"] = coin_data.get(f"{vs_currency}_market_cap")
                result["24h_volume"] = coin_data.get(f"{vs_currency}_24h_vol")
                result["24h_change"] = coin_data.get(f"{vs_currency}_24h_change")

            return result
