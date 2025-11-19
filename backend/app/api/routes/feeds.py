"""
Feed API routes.
"""

import json
import logging
from typing import List
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import SessionDep
from app.feeds import FEED_METADATA, FEED_TYPES, get_feed_class
from app.models import FeedCreate, FeedDefinition, FeedRead, FeedUpdate
from sqlmodel import select

router = APIRouter(prefix="/feeds", tags=["feeds"])
logger = logging.getLogger(__name__)


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
def create_feed(feed: FeedCreate, session: SessionDep) -> FeedDefinition:
    """Create a new feed definition."""
    # Validate feed type
    if not get_feed_class(feed.type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown feed type: {feed.type}",
        )

    # Validate config JSON
    try:
        json.loads(feed.config_json)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON in config_json",
        )

    db_feed = FeedDefinition.model_validate(feed)
    session.add(db_feed)
    session.commit()
    session.refresh(db_feed)

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
def update_feed(feed_id: UUID, feed_update: FeedUpdate, session: SessionDep) -> FeedDefinition:
    """Update a feed definition."""
    feed = session.get(FeedDefinition, feed_id)
    if not feed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found")

    # Validate feed type if being updated
    update_data = feed_update.model_dump(exclude_unset=True)
    if "type" in update_data:
        if not get_feed_class(update_data["type"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown feed type: {update_data['type']}",
            )

    # Validate config JSON if being updated
    if "config_json" in update_data:
        try:
            json.loads(update_data["config_json"])
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON in config_json",
            )

    # Update fields
    for field, value in update_data.items():
        setattr(feed, field, value)

    session.add(feed)
    session.commit()
    session.refresh(feed)

    logger.info(f"Updated feed {feed_id}")
    return feed


@router.delete("/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed(feed_id: UUID, session: SessionDep) -> None:
    """Delete a feed definition."""
    feed = session.get(FeedDefinition, feed_id)
    if not feed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found")

    session.delete(feed)
    session.commit()

    logger.info(f"Deleted feed {feed_id}")


class FeedTestResult(BaseModel):
    """Response schema for feed test results."""

    success: bool
    data: dict | None = None
    error: str | None = None
    timestamp: str


@router.post("/{feed_id}/test", response_model=FeedTestResult)
async def test_feed(feed_id: UUID, session: SessionDep) -> FeedTestResult:
    """Test a feed by fetching data once."""
    import asyncio
    from datetime import datetime, timezone

    feed = session.get(FeedDefinition, feed_id)
    if not feed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed not found")

    # Get feed class
    feed_class = get_feed_class(feed.type)
    if not feed_class:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown feed type: {feed.type}",
        )

    # Parse config
    try:
        config = json.loads(feed.config_json)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON in config_json",
        )

    # Instantiate and test feed
    try:
        feed_instance = feed_class(feed_id=feed.id, config=config, hub=None)
        data = await feed_instance.fetch_data()

        return FeedTestResult(
            success=True,
            data=data,
            error=None,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as e:
        logger.error(f"Feed test failed for {feed_id}: {e}")
        return FeedTestResult(
            success=False,
            data=None,
            error=str(e),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
