"""
Panel API routes.
"""

import json
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from app.api.deps import SessionDep
from app.models import Dashboard, Panel, PanelCreate, PanelRead, PanelUpdate

router = APIRouter(prefix="/dashboards/{dashboard_id}/panels", tags=["panels"])
logger = logging.getLogger(__name__)


@router.post("", response_model=PanelRead, status_code=status.HTTP_201_CREATED)
def create_panel(dashboard_id: UUID, panel: PanelCreate, session: SessionDep) -> Panel:
    """Create a new panel on a dashboard."""
    # Verify dashboard exists
    dashboard = session.get(Dashboard, dashboard_id)
    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found"
        )

    # Validate feed_ids_json
    try:
        json.loads(panel.feed_ids_json)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON in feed_ids_json",
        )

    # Validate options_json
    try:
        json.loads(panel.options_json)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON in options_json",
        )

    db_panel = Panel.model_validate(panel, update={"dashboard_id": dashboard_id})
    session.add(db_panel)
    session.commit()
    session.refresh(db_panel)

    logger.info(f"Created panel {db_panel.id} on dashboard {dashboard_id}")
    return db_panel


@router.patch("/{panel_id}", response_model=PanelRead)
def update_panel(
    dashboard_id: UUID, panel_id: UUID, panel_update: PanelUpdate, session: SessionDep
) -> Panel:
    """Update a panel."""
    panel = session.get(Panel, panel_id)
    if not panel or panel.dashboard_id != dashboard_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Panel not found")

    # Validate JSONs if being updated
    update_data = panel_update.model_dump(exclude_unset=True)

    if "feed_ids_json" in update_data:
        try:
            json.loads(update_data["feed_ids_json"])
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON in feed_ids_json",
            )

    if "options_json" in update_data:
        try:
            json.loads(update_data["options_json"])
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON in options_json",
            )

    # Update fields
    for field, value in update_data.items():
        setattr(panel, field, value)

    session.add(panel)
    session.commit()
    session.refresh(panel)

    logger.info(f"Updated panel {panel_id}")
    return panel


@router.delete("/{panel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_panel(dashboard_id: UUID, panel_id: UUID, session: SessionDep) -> None:
    """Delete a panel."""
    panel = session.get(Panel, panel_id)
    if not panel or panel.dashboard_id != dashboard_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Panel not found")

    session.delete(panel)
    session.commit()

    logger.info(f"Deleted panel {panel_id}")


# Standalone panel route for convenience
standalone_router = APIRouter(prefix="/panels", tags=["panels"])


@standalone_router.get("/{panel_id}", response_model=PanelRead)
def get_panel(panel_id: UUID, session: SessionDep) -> Panel:
    """Get a panel by ID."""
    panel = session.get(Panel, panel_id)
    if not panel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Panel not found")

    return panel
