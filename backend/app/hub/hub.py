"""
DataHub for managing feed events and WebSocket connections.
"""

import asyncio
import logging
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, List, Set
from uuid import UUID

from fastapi import WebSocket

from .events import FeedEvent, FeedEventMessage

logger = logging.getLogger(__name__)


class DataHub:
    """
    Central hub for managing feed events and broadcasting to WebSocket clients.

    Maintains:
    - Latest event from each feed
    - Recent history window for each feed
    - WebSocket connections grouped by dashboard ID
    - Mapping of which feeds are used by which dashboards
    """

    def __init__(self, history_window: timedelta = timedelta(minutes=10)):
        """
        Initialize DataHub.

        Args:
            history_window: How long to keep event history
        """
        self.history_window = history_window

        # Latest event per feed
        self.latest: Dict[UUID, FeedEvent] = {}

        # Recent history per feed (time-windowed)
        self.history: Dict[UUID, Deque[FeedEvent]] = defaultdict(deque)

        # WebSocket connections grouped by dashboard ID
        self.connections: Dict[UUID, List[WebSocket]] = defaultdict(list)

        # Dashboard -> Feed IDs mapping (which feeds does each dashboard use)
        self.dashboard_feeds: Dict[UUID, Set[UUID]] = defaultdict(set)

        self.logger = logging.getLogger(__name__)

    async def publish_feed_event(self, feed_id: UUID, payload: Dict[str, Any]) -> None:
        """
        Publish a feed event.

        Args:
            feed_id: Feed identifier
            payload: Data payload from the feed
        """
        # Create event
        event = FeedEvent(feed_id=feed_id, ts=datetime.utcnow(), payload=payload)

        # Update latest
        self.latest[feed_id] = event

        # Add to history
        history_deque = self.history[feed_id]
        history_deque.append(event)

        # Trim old history
        cutoff = datetime.utcnow() - self.history_window
        while history_deque and history_deque[0].ts < cutoff:
            history_deque.popleft()

        # Broadcast to relevant dashboards
        await self._broadcast_event(event)

    async def _broadcast_event(self, event: FeedEvent) -> None:
        """
        Broadcast event to all dashboards that use this feed.

        Args:
            event: FeedEvent to broadcast
        """
        # Find all dashboards that use this feed
        relevant_dashboards = [
            dashboard_id
            for dashboard_id, feed_ids in self.dashboard_feeds.items()
            if event.feed_id in feed_ids
        ]

        # Create message
        message = FeedEventMessage.from_feed_event(event)
        message_json = message.model_dump_json()

        # Send to all connections of relevant dashboards
        for dashboard_id in relevant_dashboards:
            await self._send_to_dashboard(dashboard_id, message_json)

    async def _send_to_dashboard(self, dashboard_id: UUID, message: str) -> None:
        """
        Send message to all connections of a dashboard.

        Args:
            dashboard_id: Dashboard identifier
            message: JSON message to send
        """
        connections = self.connections.get(dashboard_id, [])
        disconnected = []

        for websocket in connections:
            try:
                await websocket.send_text(message)
            except Exception as e:
                self.logger.warning(
                    f"Failed to send to connection for dashboard {dashboard_id}: {e}"
                )
                disconnected.append(websocket)

        # Remove disconnected websockets
        for ws in disconnected:
            connections.remove(ws)

    async def register_connection(
        self, dashboard_id: UUID, websocket: WebSocket, feed_ids: Set[UUID]
    ) -> None:
        """
        Register a WebSocket connection for a dashboard.

        Args:
            dashboard_id: Dashboard identifier
            websocket: WebSocket connection
            feed_ids: Set of feed IDs used by this dashboard
        """
        # Add connection
        self.connections[dashboard_id].append(websocket)

        # Update dashboard -> feeds mapping
        self.dashboard_feeds[dashboard_id].update(feed_ids)

        self.logger.info(
            f"Registered connection for dashboard {dashboard_id} with {len(feed_ids)} feeds"
        )

        # Send initial state for all feeds
        await self._send_initial_state(websocket, feed_ids)

    async def _send_initial_state(self, websocket: WebSocket, feed_ids: Set[UUID]) -> None:
        """
        Send initial state (latest events) to a newly connected client.

        Args:
            websocket: WebSocket connection
            feed_ids: Feed IDs to send state for
        """
        for feed_id in feed_ids:
            if feed_id in self.latest:
                event = self.latest[feed_id]
                message = FeedEventMessage.from_feed_event(event)
                try:
                    await websocket.send_text(message.model_dump_json())
                except Exception as e:
                    self.logger.error(f"Failed to send initial state for feed {feed_id}: {e}")

    async def unregister_connection(self, dashboard_id: UUID, websocket: WebSocket) -> None:
        """
        Unregister a WebSocket connection.

        Args:
            dashboard_id: Dashboard identifier
            websocket: WebSocket connection to remove
        """
        connections = self.connections.get(dashboard_id, [])
        if websocket in connections:
            connections.remove(websocket)
            self.logger.info(f"Unregistered connection for dashboard {dashboard_id}")

        # Clean up empty connection lists
        if not connections and dashboard_id in self.connections:
            del self.connections[dashboard_id]
            # Also remove feed mapping if no connections
            if dashboard_id in self.dashboard_feeds:
                del self.dashboard_feeds[dashboard_id]

    def get_latest(self, feed_id: UUID) -> FeedEvent | None:
        """
        Get latest event for a feed.

        Args:
            feed_id: Feed identifier

        Returns:
            Latest FeedEvent or None if no events
        """
        return self.latest.get(feed_id)

    def get_history(
        self, feed_id: UUID, since: datetime | None = None, limit: int | None = None
    ) -> List[FeedEvent]:
        """
        Get historical events for a feed.

        Args:
            feed_id: Feed identifier
            since: Only return events after this timestamp
            limit: Maximum number of events to return

        Returns:
            List of FeedEvents
        """
        history_deque = self.history.get(feed_id, deque())

        # Filter by timestamp if provided
        if since:
            events = [e for e in history_deque if e.ts > since]
        else:
            events = list(history_deque)

        # Apply limit
        if limit:
            events = events[-limit:]

        return events

    def clear_feed_data(self, feed_id: UUID) -> None:
        """
        Clear all data for a feed.

        Args:
            feed_id: Feed identifier
        """
        if feed_id in self.latest:
            del self.latest[feed_id]
        if feed_id in self.history:
            del self.history[feed_id]

        self.logger.info(f"Cleared data for feed {feed_id}")
