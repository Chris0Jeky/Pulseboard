"""
API dependencies for dependency injection.
"""

from typing import Annotated

from fastapi import Depends, HTTPException
from sqlmodel import Session

from app.db.session import get_session

# Database session dependency
SessionDep = Annotated[Session, Depends(get_session)]


def reject_nulls(update_data: dict, nullable: frozenset[str] = frozenset()) -> None:
    """Reject explicit nulls for non-nullable fields with a 422 error."""
    for field, value in update_data.items():
        if value is None and field not in nullable:
            raise HTTPException(status_code=422, detail=f"{field} cannot be null")
