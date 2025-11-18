"""
Database base configuration and engine setup.
"""

from sqlmodel import SQLModel, create_engine

from app.core.config import settings

# Create engine
engine = create_engine(
    settings.database_url,
    echo=settings.log_level == "DEBUG",
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)


def create_db_and_tables() -> None:
    """Create database and tables."""
    SQLModel.metadata.create_all(engine)


def drop_db_and_tables() -> None:
    """Drop all database tables (for testing)."""
    SQLModel.metadata.drop_all(engine)
