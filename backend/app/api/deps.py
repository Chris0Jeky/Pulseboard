"""
API dependencies for dependency injection.
"""

from typing import Annotated, Generator

from fastapi import Depends
from sqlmodel import Session

from app.db.session import get_session

# Database session dependency
SessionDep = Annotated[Session, Depends(get_session)]
