"""
WebSocket router for dashboard streaming.
"""

import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status

from app.api.deps import SessionDep
from app.hub.hub import DataHub
from app.models import Dashboard

logger = logging.getLogger(__name__)

# This will be injected by the main app
_hub: DataHub | None = None


def set_hub(hub: DataHub) -> None:
    """Set the global DataHub instance."""
    global _hub
    _hub = hub


def get_hub() -> DataHub:
    """Get the global DataHub instance."""
    if _hub is None:
        raise RuntimeError("DataHub not initialized")
    return _hub


router = APIRouter()


@router.websocket("/ws/dashboards/{dashboard_id}")
async def websocket_dashboard(
    websocket: WebSocket,
    dashboard_id: UUID,
    session: SessionDep,
    hub: DataHub = Depends(get_hub),
):
    """
    WebSocket endpoint for real-time dashboard updates.

    Accepts connection, registers with DataHub, and keeps connection alive.
    DataHub will send feed updates to this connection.
    """
    try:
        # Verify dashboard exists
        dashboard = session.get(Dashboard, dashboard_id)
        if not dashboard:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Get feed IDs used by this dashboard
        feed_ids = set()
        for panel in dashboard.panels:
            try:
                panel_feed_ids = json.loads(panel.feed_ids_json)
                for feed_id_str in panel_feed_ids:
                    try:
                        feed_ids.add(UUID(feed_id_str))
                    except ValueError:
                        logger.warning(f"Invalid feed ID in panel {panel.id}: {feed_id_str}")
            except json.JSONDecodeError:
                logger.warning(f"Invalid feed_ids_json in panel {panel.id}")

        # Accept connection
        await websocket.accept()

        # Register with DataHub
        await hub.register_connection(dashboard_id, websocket, feed_ids)

        logger.info(
            f"WebSocket connected for dashboard {dashboard_id} with {len(feed_ids)} feeds"
        )

        # Keep connection alive and handle incoming messages (if any)
        try:
            while True:
                # Wait for messages (ping/pong or client messages)
                data = await websocket.receive_text()

                # Handle client messages if needed
                try:
                    message = json.loads(data)
                    if message.get("type") == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON from client: {data}")

        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected for dashboard {dashboard_id}")

    except Exception as e:
        logger.error(f"WebSocket error for dashboard {dashboard_id}: {e}", exc_info=True)

    finally:
        # Unregister from DataHub
        await hub.unregister_connection(dashboard_id, websocket)
