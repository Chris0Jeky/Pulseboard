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

# One deadline for the entire revoked dashboard, not one delay per socket.
CLOSE_TIMEOUT_SECONDS = 1.0
# A client that cannot accept one message within this deadline is dropped.
SEND_TIMEOUT_SECONDS = 5.0


class DataHub:
    """
    Central hub for managing feed events and broadcasting to WebSocket clients.

    Maintains:
    - Latest event from each feed
    - Recent history window and event-count ceiling for each feed
    - WebSocket connections grouped by dashboard ID
    - Mapping of which feeds are used by which dashboards
    """

    def __init__(
        self,
        history_window: timedelta = timedelta(minutes=10),
        *,
        history_limit: int = 10_000,
    ):
        """
        Initialize DataHub.

        Args:
            history_window: How long to keep event history
            history_limit: Maximum retained events per feed; oldest events are evicted.
                This bounds event count, not payload bytes or the total number of feeds.
        """
        if (
            isinstance(history_limit, bool)
            or not isinstance(history_limit, int)
            or history_limit < 1
        ):
            raise ValueError("history_limit must be a positive integer")
        self.history_window = history_window

        # Latest event per feed
        self.latest: Dict[UUID, FeedEvent] = {}
        # Internal ordering only: no sequence field is added to the wire message.
        self._publish_sequence = 0
        self._latest_sequences: Dict[UUID, int] = {}

        # Bound high-rate publishers even when every event is still inside the time window.
        self.history: Dict[UUID, Deque[FeedEvent]] = defaultdict(
            lambda: deque(maxlen=history_limit)
        )

        # WebSocket connections grouped by dashboard ID
        self.connections: Dict[UUID, List[WebSocket]] = defaultdict(list)

        # Dashboard -> Feed IDs mapping (which feeds does each dashboard use)
        self.dashboard_feeds: Dict[UUID, Set[UUID]] = defaultdict(set)
        self._connection_feeds: Dict[WebSocket, Set[UUID]] = {}
        self._send_locks: Dict[WebSocket, asyncio.Lock] = {}
        self._connection_sequences: Dict[WebSocket, Dict[UUID, int]] = {}

        # Keep cancellation-resistant transport tasks alive until they actually settle.
        # They cannot regain membership or block deletion after the close deadline.
        self._closing_tasks: set[asyncio.Task[Any]] = set()
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
        self._publish_sequence += 1
        self._latest_sequences[feed_id] = self._publish_sequence

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
        sequence = (
            self._latest_sequences.get(event.feed_id)
            if self.latest.get(event.feed_id) is event
            else None
        )

        # Send to all dashboards concurrently so one stalled dashboard cannot delay others.
        results = await asyncio.gather(
            *(
                self._send_to_dashboard(d, message_json, event.feed_id, sequence)
                for d in relevant_dashboards
            ),
            return_exceptions=True,
        )
        for dashboard_id, result in zip(relevant_dashboards, results, strict=True):
            if isinstance(result, Exception):
                self.logger.error(
                    f"Failed to broadcast to dashboard {dashboard_id}", exc_info=result
                )

    async def _send_to_dashboard(
        self,
        dashboard_id: UUID,
        message: str,
        feed_id: UUID | None = None,
        sequence: int | None = None,
    ) -> None:
        """
        Send message to all connections of a dashboard.

        Args:
            dashboard_id: Dashboard identifier
            message: JSON message to send
        """
        snapshot = list(self.connections.get(dashboard_id, []))
        sends = {
            asyncio.create_task(
                self._send_one(dashboard_id, websocket, message, feed_id, sequence)
            ): websocket
            for websocket in snapshot
        }
        if not sends:
            return
        try:
            done, pending = await asyncio.wait(sends, timeout=SEND_TIMEOUT_SECONDS)
        except BaseException:
            # The publisher was cancelled mid-wait: asyncio.wait does not cancel its
            # children, so do it here rather than leave sends running unbounded.
            for task in sends:
                task.cancel()
            raise

        disconnected = [ws for task, ws in sends.items() if task in done and not task.result()]
        for task in pending:
            self.logger.warning(
                f"Send timed out for a connection of dashboard {dashboard_id}"
            )
            # Do not await the cancelled send: a stalled transport may suppress
            # cancellation. Keep the task referenced until it actually settles.
            task.cancel()
            self._closing_tasks.add(task)
            task.add_done_callback(self._closing_tasks.discard)
            disconnected.append(sends[task])
            self._spawn_close(dashboard_id, sends[task])

        # Re-resolve via unregister_connection, which also cleans up
        # dashboards left with no connections.
        for ws in disconnected:
            await self.unregister_connection(dashboard_id, ws)

    async def _send_one(
        self,
        dashboard_id: UUID,
        websocket: WebSocket,
        message: str,
        feed_id: UUID | None = None,
        sequence: int | None = None,
    ) -> bool:
        """Send to one socket; False if it failed. Skips sockets unregistered meanwhile."""
        if websocket not in self.connections.get(dashboard_id, []):
            return True
        lock = self._send_locks.setdefault(websocket, asyncio.Lock())
        async with lock:
            if self._send_locks.get(websocket) is not lock:
                return True
            return await self._send_unlocked(
                dashboard_id, websocket, message, feed_id, sequence
            )

    async def _send_unlocked(
        self,
        dashboard_id: UUID,
        websocket: WebSocket,
        message: str,
        feed_id: UUID | None = None,
        sequence: int | None = None,
    ) -> bool:
        """Recheck membership and subscriptions after acquiring the socket's send lock."""
        if websocket not in self.connections.get(dashboard_id, []):
            return True
        if feed_id is not None and feed_id not in self._connection_feeds.get(
            websocket, set()
        ):
            return True
        sequences = self._connection_sequences.setdefault(websocket, {})
        if feed_id is not None and sequence is not None:
            # A delayed live send may queue behind an initial snapshot that already
            # includes it or a newer publication. Never move that feed backwards.
            if sequence <= sequences.get(feed_id, 0):
                return True
        try:
            await websocket.send_text(message)
        except Exception as e:
            self.logger.warning(
                f"Failed to send to connection for dashboard {dashboard_id}: {e}"
            )
            return False
        if (
            feed_id is not None
            and sequence is not None
            and self._connection_sequences.get(websocket) is sequences
            and feed_id in self._connection_feeds.get(websocket, set())
        ):
            # Failed sends never advance the watermark. An unregistered/replaced
            # connection's in-flight send must not update its replacement's state.
            sequences[feed_id] = max(sequence, sequences.get(feed_id, 0))
        return True

    def _spawn_close(self, dashboard_id: UUID, websocket: WebSocket) -> None:
        """Best-effort close of a dropped socket without blocking the caller."""
        task = asyncio.create_task(self._close_revoked_connection(dashboard_id, websocket))
        self._closing_tasks.add(task)
        task.add_done_callback(self._closing_tasks.discard)

    async def register_connection(
        self, dashboard_id: UUID, websocket: WebSocket, feed_ids: Set[UUID]
    ) -> None:
        """
        Register a WebSocket connection for a dashboard.

        Args:
            dashboard_id: Dashboard identifier
            websocket: WebSocket connection
            feed_ids: Set of feed IDs used by this connection
        """
        # Add connection
        self.connections[dashboard_id].append(websocket)

        self._connection_feeds[websocket] = set(feed_ids)
        self._update_dashboard_feeds(dashboard_id)

        self.logger.info(
            f"Registered connection for dashboard {dashboard_id} with {len(feed_ids)} feeds"
        )

        # Send initial state for all feeds
        await self._send_initial_state(dashboard_id, websocket, feed_ids)

    async def refresh_dashboard_feeds(
        self, dashboard_id: UUID, websocket: WebSocket, feed_ids: Set[UUID]
    ) -> None:
        """
        Replace one connection's feed set and send state for its added feeds.

        No-op when the dashboard has no registered connections.
        """
        if websocket not in self.connections.get(dashboard_id, []):
            return

        previous = self._connection_feeds[websocket]
        self._connection_feeds[websocket] = set(feed_ids)
        sequences = self._connection_sequences.get(websocket, {})
        for feed_id in list(sequences):
            if feed_id not in self._connection_feeds[websocket]:
                del sequences[feed_id]
        self._update_dashboard_feeds(dashboard_id)

        await self._send_initial_state(dashboard_id, websocket, set(feed_ids) - previous)

    def _update_dashboard_feeds(self, dashboard_id: UUID) -> None:
        self.dashboard_feeds[dashboard_id] = set().union(
            *(self._connection_feeds[ws] for ws in self.connections[dashboard_id])
        )

    async def _send_initial_state(
        self, dashboard_id: UUID, websocket: WebSocket, feed_ids: Set[UUID]
    ) -> None:
        """Bound the whole initial batch, including time queued behind another send."""
        cached_feeds = [feed_id for feed_id in feed_ids if feed_id in self.latest]
        if not cached_feeds:
            return
        task = asyncio.create_task(
            self._send_initial_batch(dashboard_id, websocket, cached_feeds)
        )
        completed = False
        try:
            done, _ = await asyncio.wait({task}, timeout=SEND_TIMEOUT_SECONDS)
            completed = bool(done) and task.result()
        finally:
            if not completed:
                # Cancellation-resistant transports must not hold registration or refresh.
                if not task.done():
                    task.cancel()
                    self._closing_tasks.add(task)
                    task.add_done_callback(self._closing_tasks.discard)
                await self.unregister_connection(dashboard_id, websocket)
                self._spawn_close(dashboard_id, websocket)

    async def _send_initial_batch(
        self, dashboard_id: UUID, websocket: WebSocket, feed_ids: List[UUID]
    ) -> bool:
        if websocket not in self.connections.get(dashboard_id, []):
            return True
        lock = self._send_locks.setdefault(websocket, asyncio.Lock())
        async with lock:
            if self._send_locks.get(websocket) is not lock:
                return True
            snapshot = []
            for feed_id in feed_ids:
                event = self.latest.get(feed_id)
                if event is not None:
                    message = FeedEventMessage.from_feed_event(event)
                    snapshot.append(
                        (feed_id, message.model_dump_json(), self._latest_sequences.get(feed_id))
                    )
            # Freeze every cached message before the first send yields. Otherwise
            # live updates queued during A can change B's cached value mid-batch.
            for feed_id, message_json, sequence in snapshot:
                # Preserve transient-error continuation for the remaining feeds.
                await self._send_unlocked(
                    dashboard_id, websocket, message_json, feed_id, sequence
                )
        return True

    async def disconnect_dashboard(self, dashboard_id: UUID) -> None:
        """Revoke all membership before awaiting best-effort socket closure."""
        connections = self.connections.pop(dashboard_id, [])
        self.dashboard_feeds.pop(dashboard_id, None)
        for websocket in connections:
            self._connection_feeds.pop(websocket, None)
            self._send_locks.pop(websocket, None)
            self._connection_sequences.pop(websocket, None)
        if not connections:
            return
        tasks = {
            asyncio.create_task(self._close_revoked_connection(dashboard_id, websocket))
            for websocket in connections
        }
        self._closing_tasks.update(tasks)
        for task in tasks:
            task.add_done_callback(self._closing_tasks.discard)
        try:
            _, pending = await asyncio.wait(tasks, timeout=CLOSE_TIMEOUT_SECONDS)
            if pending:
                self.logger.warning(
                    f"Socket close deadline reached for dashboard {dashboard_id}"
                )
        finally:
            # Do not await cancelled transports: a close coroutine may suppress
            # cancellation, which would make wait_for/gather unbounded again.
            for task in tasks:
                if not task.done():
                    task.cancel()

    async def _close_revoked_connection(self, dashboard_id: UUID, websocket: WebSocket) -> None:
        """Close one revoked socket without exposing transport exception content."""
        try:
            await websocket.close(code=1008)
        except Exception:
            self.logger.warning(
                f"Failed to close revoked connection for dashboard {dashboard_id}"
            )

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
            self._connection_feeds.pop(websocket, None)
            self._send_locks.pop(websocket, None)
            self._connection_sequences.pop(websocket, None)
            if connections:
                self._update_dashboard_feeds(dashboard_id)
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
        self._latest_sequences.pop(feed_id, None)
        if feed_id in self.history:
            del self.history[feed_id]

        self.logger.info(f"Cleared data for feed {feed_id}")
