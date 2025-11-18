#!/usr/bin/env python3
"""
Seed the database with demo dashboards, feeds, and panels.
"""

import json
import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from sqlmodel import Session

from app.db.base import create_db_and_tables, engine
from app.models import Dashboard, FeedDefinition, Panel


def seed_database():
    """Seed database with demo data."""
    print("Creating database tables...")
    create_db_and_tables()

    with Session(engine) as session:
        print("Seeding demo data...")

        # Create feeds
        system_feed = FeedDefinition(
            type="system_metrics",
            name="System Metrics",
            config_json=json.dumps({"interval_sec": 2, "include_disk": True}),
            enabled=True,
        )

        btc_feed = FeedDefinition(
            type="crypto_price",
            name="Bitcoin Price",
            config_json=json.dumps(
                {"coin_id": "bitcoin", "vs_currency": "usd", "interval_sec": 30}
            ),
            enabled=True,
        )

        eth_feed = FeedDefinition(
            type="crypto_price",
            name="Ethereum Price",
            config_json=json.dumps(
                {"coin_id": "ethereum", "vs_currency": "usd", "interval_sec": 30}
            ),
            enabled=True,
        )

        session.add(system_feed)
        session.add(btc_feed)
        session.add(eth_feed)
        session.commit()
        session.refresh(system_feed)
        session.refresh(btc_feed)
        session.refresh(eth_feed)

        print(f"  Created feed: {system_feed.name} (ID: {system_feed.id})")
        print(f"  Created feed: {btc_feed.name} (ID: {btc_feed.id})")
        print(f"  Created feed: {eth_feed.name} (ID: {eth_feed.id})")

        # Create dashboard
        dashboard = Dashboard(
            name="System & Crypto Monitor",
            description="Real-time system metrics and cryptocurrency prices",
            layout_json=json.dumps({"columns": 12, "rowHeight": 100}),
        )

        # Create panels
        cpu_panel = Panel(
            type="stat",
            title="CPU Usage",
            feed_ids_json=json.dumps([str(system_feed.id)]),
            options_json=json.dumps(
                {"field": "cpu_percent", "unit": "%", "decimals": 1}
            ),
            position_x=0,
            position_y=0,
            width=3,
            height=2,
        )

        memory_panel = Panel(
            type="stat",
            title="Memory Usage",
            feed_ids_json=json.dumps([str(system_feed.id)]),
            options_json=json.dumps(
                {"field": "memory_percent", "unit": "%", "decimals": 1}
            ),
            position_x=3,
            position_y=0,
            width=3,
            height=2,
        )

        cpu_chart_panel = Panel(
            type="timeseries",
            title="CPU Over Time",
            feed_ids_json=json.dumps([str(system_feed.id)]),
            options_json=json.dumps(
                {"field": "cpu_percent", "color": "#3b82f6", "max": 100}
            ),
            position_x=0,
            position_y=2,
            width=6,
            height=3,
        )

        memory_chart_panel = Panel(
            type="timeseries",
            title="Memory Over Time",
            feed_ids_json=json.dumps([str(system_feed.id)]),
            options_json=json.dumps(
                {"field": "memory_percent", "color": "#10b981", "max": 100}
            ),
            position_x=6,
            position_y=2,
            width=6,
            height=3,
        )

        btc_panel = Panel(
            type="stat",
            title="Bitcoin (BTC)",
            feed_ids_json=json.dumps([str(btc_feed.id)]),
            options_json=json.dumps(
                {"field": "price", "prefix": "$", "decimals": 2}
            ),
            position_x=6,
            position_y=0,
            width=3,
            height=2,
        )

        eth_panel = Panel(
            type="stat",
            title="Ethereum (ETH)",
            feed_ids_json=json.dumps([str(eth_feed.id)]),
            options_json=json.dumps(
                {"field": "price", "prefix": "$", "decimals": 2}
            ),
            position_x=9,
            position_y=0,
            width=3,
            height=2,
        )

        dashboard.panels.extend(
            [
                cpu_panel,
                memory_panel,
                cpu_chart_panel,
                memory_chart_panel,
                btc_panel,
                eth_panel,
            ]
        )

        session.add(dashboard)
        session.commit()
        session.refresh(dashboard)

        print(f"  Created dashboard: {dashboard.name} (ID: {dashboard.id})")
        print(f"  Created {len(dashboard.panels)} panels")

        print("\nDemo data seeded successfully!")
        print(f"\nDashboard ID: {dashboard.id}")
        print("Start the server and navigate to the dashboard to see it in action.")


if __name__ == "__main__":
    seed_database()
