"""
Dashboard database models and schemas.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from sqlmodel import Column, DateTime, Field as SQLField, Relationship, SQLModel, func


class DashboardBase(SQLModel):
    """Base dashboard model with common fields."""

    name: str = SQLField(index=True, min_length=1, max_length=200)
    description: Optional[str] = SQLField(default=None, max_length=1000)
    layout_json: str = SQLField(default="{}")


class Dashboard(DashboardBase, table=True):
    """Dashboard database model."""

    __tablename__ = "dashboards"

    id: UUID = SQLField(default_factory=uuid4, primary_key=True)
    created_at: datetime = SQLField(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = SQLField(
        default_factory=datetime.utcnow,
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        ),
    )

    # Relationship to panels
    panels: List["Panel"] = Relationship(back_populates="dashboard", cascade_delete=True)


class DashboardCreate(DashboardBase):
    """Schema for creating a dashboard."""

    pass


class DashboardUpdate(BaseModel):
    """Schema for updating a dashboard."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    layout_json: Optional[str] = None


class DashboardRead(DashboardBase):
    """Schema for reading a dashboard."""

    id: UUID
    created_at: datetime
    updated_at: datetime


class DashboardReadWithPanels(DashboardRead):
    """Schema for reading a dashboard with its panels."""

    panels: List["PanelRead"] = []


# Import Panel for relationship (avoid circular import)
from app.models.panel import Panel, PanelRead  # noqa: E402

DashboardReadWithPanels.model_rebuild()
