"""
Panel definition database models and schemas.
"""

from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from sqlmodel import Field as SQLField, Relationship, SQLModel


class PanelBase(SQLModel):
    """Base panel model with common fields."""

    type: str = SQLField(min_length=1, max_length=100)
    title: str = SQLField(min_length=1, max_length=200)
    feed_ids_json: str = SQLField(default="[]")
    options_json: str = SQLField(default="{}")
    position_x: int = SQLField(default=0, ge=0)
    position_y: int = SQLField(default=0, ge=0)
    width: int = SQLField(default=4, ge=1, le=12)
    height: int = SQLField(default=4, ge=1, le=12)


class Panel(PanelBase, table=True):
    """Panel database model."""

    __tablename__ = "panels"

    id: UUID = SQLField(default_factory=uuid4, primary_key=True)
    dashboard_id: UUID = SQLField(foreign_key="dashboards.id", index=True)

    # Relationship to dashboard
    dashboard: "Dashboard" = Relationship(back_populates="panels")


class PanelCreate(PanelBase):
    """Schema for creating a panel."""

    pass


class PanelUpdate(BaseModel):
    """Schema for updating a panel."""

    type: Optional[str] = Field(default=None, min_length=1, max_length=100)
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    feed_ids_json: Optional[str] = None
    options_json: Optional[str] = None
    position_x: Optional[int] = Field(default=None, ge=0)
    position_y: Optional[int] = Field(default=None, ge=0)
    width: Optional[int] = Field(default=None, ge=1, le=12)
    height: Optional[int] = Field(default=None, ge=1, le=12)


class PanelRead(PanelBase):
    """Schema for reading a panel."""

    id: UUID
    dashboard_id: UUID


# Import Dashboard for relationship (avoid circular import)
from app.models.dashboard import Dashboard  # noqa: E402, F401
