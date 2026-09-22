"""
WebSocket router for dashboard streaming.
"""

import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status

from app.api.deps import SessionDep
from app.hub.hub import DataHub
from app.models import Dashboard

logger = logging.getLogger(__name__)

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
) -> None:
    """Stream real-time updates for one dashboard."""
    try:
        dashboard = session.get(Dashboard, dashboard_id)
        if not dashboard:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        feed_ids: set[UUID] = set()
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

        await websocket.accept()
        await hub.register_connection(dashboard_id, websocket, feed_ids)

        logger.info(
            f"WebSocket connected for dashboard {dashboard_id} with {len(feed_ids)} feeds"
        )

        try:
            while True:
                data = await websocket.receive_text()
                try:
                    message = json.loads(data)
                    if message.get("type") == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON from client: {data}")
        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected for dashboard {dashboard_id}")

    except Exception as exc:
        logger.error(
            f"WebSocket error for dashboard {dashboard_id}: {exc}", exc_info=True
        )
    finally:
        await hub.unregister_connection(dashboard_id, websocket)
