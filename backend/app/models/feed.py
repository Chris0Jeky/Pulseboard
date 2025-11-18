"""
Feed definition database models and schemas.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from sqlmodel import Column, DateTime, Field as SQLField, SQLModel, func


class FeedDefinitionBase(SQLModel):
    """Base feed definition model with common fields."""

    type: str = SQLField(index=True, min_length=1, max_length=100)
    name: str = SQLField(index=True, min_length=1, max_length=200)
    config_json: str = SQLField(default="{}")
    enabled: bool = SQLField(default=True, index=True)


class FeedDefinition(FeedDefinitionBase, table=True):
    """Feed definition database model."""

    __tablename__ = "feed_definitions"

    id: UUID = SQLField(default_factory=uuid4, primary_key=True)
    created_at: datetime = SQLField(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = SQLField(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()),
    )


class FeedCreate(FeedDefinitionBase):
    """Schema for creating a feed definition."""

    pass


class FeedUpdate(BaseModel):
    """Schema for updating a feed definition."""

    type: Optional[str] = Field(default=None, min_length=1, max_length=100)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    config_json: Optional[str] = None
    enabled: Optional[bool] = None


class FeedRead(FeedDefinitionBase):
    """Schema for reading a feed definition."""

    id: UUID
    created_at: datetime
    updated_at: datetime
