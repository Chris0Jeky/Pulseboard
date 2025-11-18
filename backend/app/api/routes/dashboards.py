"""
Dashboard API routes.
"""

import json
import logging
from typing import List
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.api.deps import SessionDep
from app.models import (
    Dashboard,
    DashboardCreate,
    DashboardRead,
    DashboardReadWithPanels,
    DashboardUpdate,
    Panel,
)

router = APIRouter(prefix="/dashboards", tags=["dashboards"])
logger = logging.getLogger(__name__)


@router.get("", response_model=List[DashboardRead])
def list_dashboards(session: SessionDep) -> List[Dashboard]:
    """List all dashboards."""
    statement = select(Dashboard)
    dashboards = session.exec(statement).all()
    return list(dashboards)


@router.post("", response_model=DashboardRead, status_code=status.HTTP_201_CREATED)
def create_dashboard(dashboard: DashboardCreate, session: SessionDep) -> Dashboard:
    """Create a new dashboard."""
    db_dashboard = Dashboard.model_validate(dashboard)
    session.add(db_dashboard)
    session.commit()
    session.refresh(db_dashboard)

    logger.info(f"Created dashboard {db_dashboard.id}: {db_dashboard.name}")
    return db_dashboard


@router.get("/{dashboard_id}", response_model=DashboardReadWithPanels)
def get_dashboard(dashboard_id: UUID, session: SessionDep) -> Dashboard:
    """Get a dashboard by ID with its panels."""
    dashboard = session.get(Dashboard, dashboard_id)
    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found"
        )

    return dashboard


@router.patch("/{dashboard_id}", response_model=DashboardRead)
def update_dashboard(
    dashboard_id: UUID, dashboard_update: DashboardUpdate, session: SessionDep
) -> Dashboard:
    """Update a dashboard."""
    dashboard = session.get(Dashboard, dashboard_id)
    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found"
        )

    # Update fields
    update_data = dashboard_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(dashboard, field, value)

    session.add(dashboard)
    session.commit()
    session.refresh(dashboard)

    logger.info(f"Updated dashboard {dashboard_id}")
    return dashboard


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dashboard(dashboard_id: UUID, session: SessionDep) -> None:
    """Delete a dashboard and its panels."""
    dashboard = session.get(Dashboard, dashboard_id)
    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found"
        )

    session.delete(dashboard)
    session.commit()

    logger.info(f"Deleted dashboard {dashboard_id}")


@router.get("/{dashboard_id}/feed-ids", response_model=List[UUID])
def get_dashboard_feed_ids(dashboard_id: UUID, session: SessionDep) -> List[UUID]:
    """
    Get all feed IDs used by a dashboard's panels.

    This is used by the WebSocket endpoint to know which feeds to subscribe to.
    """
    dashboard = session.get(Dashboard, dashboard_id)
    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found"
        )

    # Collect all feed IDs from panels
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

    return list(feed_ids)
