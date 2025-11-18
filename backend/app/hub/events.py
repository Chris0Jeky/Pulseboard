"""
Feed event models.
"""

from datetime import datetime
from typing import Any, Dict
from uuid import UUID

from pydantic import BaseModel, Field


class FeedEvent(BaseModel):
    """Event emitted by a feed with data payload."""

    feed_id: UUID
    ts: datetime = Field(default_factory=datetime.utcnow)
    payload: Dict[str, Any]

    class Config:
        """Pydantic configuration."""

        json_encoders = {datetime: lambda v: v.isoformat()}


class FeedEventMessage(BaseModel):
    """WebSocket message containing a feed event."""

    type: str = "feed_update"
    feed_id: UUID
    ts: datetime
    payload: Dict[str, Any]

    @classmethod
    def from_feed_event(cls, event: FeedEvent) -> "FeedEventMessage":
        """Create message from FeedEvent."""
        return cls(feed_id=event.feed_id, ts=event.ts, payload=event.payload)
