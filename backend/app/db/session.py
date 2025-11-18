"""
Database session management.
"""

from typing import Generator

from sqlmodel import Session

from .base import engine


def get_session() -> Generator[Session, None, None]:
    """
    Get database session.

    Yields:
        Session: SQLModel database session
    """
    with Session(engine) as session:
        yield session
