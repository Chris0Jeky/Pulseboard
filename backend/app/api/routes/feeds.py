"""
Feed API routes.
"""

import json
import logging
import math
from datetime import datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel
from sqlmodel import select

from app.api.deps import SessionDep
from app.feeds import FEED_METADATA, FEED_TYPES, get_feed_class
from app.feeds.manager import FeedManager
from app.hub.hub import DataHub
from app.models import FeedCreate, FeedDefinition, FeedRead, FeedUpdate

router = APIRouter(prefix="/feeds", tags=["feeds"])
logger = logging.getLogger(__name__)


def _feed_manager(request: Request) -> FeedManager | None:
    """Return the running FeedManager, or None when lifespan is not active."""
    return getattr(request.app.state, "feed_manager", None)


def _validate_interval_sec(config: dict) -> None:
    """Reject out-of-range or non-numeric interval_sec values."""
    if "interval_sec" not in config:
        return
    value = config["interval_sec"]
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not 1 <= value <= 86400
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="interval_sec must be a number of seconds between 1 and 86400",
        )


class FeedTypeInfo(BaseModel):
    """Response schema for feed type metadata."""

    type: str
    name: str
    description: str
    default_config: dict


@router.get("", response_model=List[FeedRead])
def list_feeds(session: SessionDep) -> List[FeedDefinition]:
    """List all feed definitions."""
    statement = select(FeedDefinition)
    feeds = session.exec(statement).all()
    return list(feeds)


@router.get("/types", response_model=List[FeedTypeInfo])
def list_feed_types() -> List[FeedTypeInfo]:
    """Return available feed types and default configuration templates."""

    feed_types: list[FeedTypeInfo] = []

    for feed_type in FEED_TYPES.keys():
        metadata = FEED_METADATA.get(feed_type, {})
        feed_types.append(
            FeedTypeInfo(
                type=feed_type,
                name=metadata.get("name", feed_type),
                description=metadata.get("description", ""),
                default_config=metadata.get("default_config", {}),
            )
        )

    return feed_types


@router.post("", response_model=FeedRead, status_code=status.HTTP_201_CREATED)
async def create_feed(
    feed: FeedCreate, session: SessionDep, request: Request
) -> FeedDefinition:
    """Create a new feed definition."""
    if not get_feed_class(feed.type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown feed type: {feed.type}",
        )

    try:
        parsed_config = json.loads(feed.config_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON in config_json",
        ) from exc

    if isinstance(parsed_config, dict):
        _validate_interval_sec(parsed_config)

    db_feed = FeedDefinition.model_validate(feed)
    session.add(db_feed)
    session.commit()
    session.refresh(db_feed)

    manager = _feed_manager(request)
    if manager is not None and db_feed.enabled:
        try:
            await manager.start_feed(db_feed)
        except Exception:
            logger.exception(f"Failed to start feed {db_feed.id} after create")
    logger.info(f"Created feed {db_feed.id}: {db_feed.name} ({db_feed.type})")
    return db_feed


@router.get("/{feed_id}", response_model=FeedRead)
def get_feed(feed_id: UUID, session: SessionDep) -> FeedDefinition:
    """Get a feed definition by ID."""
    feed = session.get(FeedDefinition, feed_id)
    if not feed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found")

    return feed


@router.patch("/{feed_id}", response_model=FeedRead)
async def update_feed(
    feed_id: UUID, feed_update: FeedUpdate, session: SessionDep, request: Request
) -> FeedDefinition:
    """Update a feed definition."""
    feed = session.get(FeedDefinition, feed_id)
    if not feed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found")

    update_data = feed_update.model_dump(exclude_unset=True)
    parsed_update_config = None
    if "type" in update_data and not get_feed_class(update_data["type"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown feed type: {update_data['type']}",
        )

    if "config_json" in update_data:
        try:
            parsed_update_config = json.loads(update_data["config_json"])
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON in config_json",
            ) from exc

    if "config_json" in update_data and isinstance(parsed_update_config, dict):
        _validate_interval_sec(parsed_update_config)

    for field, value in update_data.items():
        setattr(feed, field, value)

    session.add(feed)
    session.commit()
    session.refresh(feed)

    manager = _feed_manager(request)
    if manager is not None:
        try:
            await manager.restart_feed(session, feed_id)
        except Exception:
            logger.exception(f"Failed to restart feed {feed_id} after update")
    logger.info(f"Updated feed {feed_id}")
    return feed


@router.delete("/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feed(feed_id: UUID, session: SessionDep, request: Request) -> None:
    """Delete a feed definition."""
    feed = session.get(FeedDefinition, feed_id)
    if not feed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found")

    session.delete(feed)
    session.commit()

    manager = _feed_manager(request)
    if manager is not None:
        try:
            await manager.stop_feed(feed_id)
        except Exception:
            logger.exception(f"Failed to stop feed {feed_id} after delete")
    logger.info(f"Deleted feed {feed_id}")


class FeedTestResult(BaseModel):
    """Response schema for feed test results."""

    success: bool
    data: dict | None = None
    error: str | None = None
    timestamp: str


@router.post("/{feed_id}/test", response_model=FeedTestResult)
async def test_feed(feed_id: UUID, session: SessionDep) -> FeedTestResult:
    """Test a feed by fetching data once without publishing to live dashboards."""
    feed = session.get(FeedDefinition, feed_id)
    if not feed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found")

    feed_class = get_feed_class(feed.type)
    if not feed_class:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown feed type: {feed.type}",
        )

    try:
        config = json.loads(feed.config_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON in config_json",
        ) from exc

    try:
        feed_instance = feed_class(feed_id=feed.id, config=config, hub=DataHub())
        data = await feed_instance.fetch_data()

        return FeedTestResult(
            success=True,
            data=data,
            error=None,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as exc:
        logger.error(f"Feed test failed for {feed_id}: {exc}")
        return FeedTestResult(
            success=False,
            data=None,
            error=str(exc),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
