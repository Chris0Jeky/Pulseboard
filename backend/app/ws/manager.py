"""
WebSocket connection manager.
"""

import logging
from typing import Dict, List
from uuid import UUID

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Manages WebSocket connections.

    Note: This is a simple implementation. The DataHub also manages
    connections, but this provides a clean interface for the WebSocket router.
    """

    def __init__(self):
        """Initialize connection manager."""
        self.active_connections: Dict[UUID, List[WebSocket]] = {}
        self.logger = logging.getLogger(__name__)

    async def connect(self, dashboard_id: UUID, websocket: WebSocket) -> None:
        """
        Accept and register a WebSocket connection.

        Args:
            dashboard_id: Dashboard identifier
            websocket: WebSocket connection
        """
        await websocket.accept()

        if dashboard_id not in self.active_connections:
            self.active_connections[dashboard_id] = []

        self.active_connections[dashboard_id].append(websocket)
        self.logger.info(
            f"WebSocket connected for dashboard {dashboard_id}. "
            f"Total connections: {len(self.active_connections[dashboard_id])}"
        )

    def disconnect(self, dashboard_id: UUID, websocket: WebSocket) -> None:
        """
        Unregister a WebSocket connection.

        Args:
            dashboard_id: Dashboard identifier
            websocket: WebSocket connection
        """
        if dashboard_id in self.active_connections:
            if websocket in self.active_connections[dashboard_id]:
                self.active_connections[dashboard_id].remove(websocket)
                self.logger.info(f"WebSocket disconnected for dashboard {dashboard_id}")

            # Clean up empty lists
            if not self.active_connections[dashboard_id]:
                del self.active_connections[dashboard_id]

    async def send_personal_message(
        self, message: str, websocket: WebSocket
    ) -> None:
        """
        Send a message to a specific WebSocket.

        Args:
            message: JSON message to send
            websocket: WebSocket connection
        """
        await websocket.send_text(message)

    async def broadcast_to_dashboard(
        self, dashboard_id: UUID, message: str
    ) -> None:
        """
        Broadcast a message to all connections of a dashboard.

        Args:
            dashboard_id: Dashboard identifier
            message: JSON message to send
        """
        connections = self.active_connections.get(dashboard_id, [])
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
            self.disconnect(dashboard_id, ws)

    def get_connection_count(self, dashboard_id: UUID) -> int:
        """
        Get number of active connections for a dashboard.

        Args:
            dashboard_id: Dashboard identifier

        Returns:
            Number of active connections
        """
        return len(self.active_connections.get(dashboard_id, []))


# Global instance
manager = ConnectionManager()
