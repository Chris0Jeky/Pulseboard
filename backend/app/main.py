"""
Main FastAPI application for Pulseboard.

This module initializes the FastAPI app, sets up database, DataHub,
FeedManager, and mounts all routes.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from app.api.routes import dashboards, feeds, panels
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.base import create_db_and_tables, engine
from app.feeds.manager import FeedManager
from app.hub.hub import DataHub
from app.ws import router as ws_router

setup_logging()
logger = logging.getLogger(__name__)

hub: DataHub | None = None
feed_manager: FeedManager | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize and stop the application-owned runtime services."""
    global hub, feed_manager

    logger.info("Starting Pulseboard application...")

    create_db_and_tables()
    logger.info("Database initialized")

    hub = DataHub(history_window=timedelta(minutes=settings.history_window_minutes))
    logger.info("DataHub initialized")

    ws_router.set_hub(hub)
    feed_manager = FeedManager(hub)
    app.state.feed_manager = feed_manager

    with Session(engine) as session:
        await feed_manager.load_feeds(session)

    logger.info("Application startup complete")

    yield

    logger.info("Shutting down application...")

    if feed_manager:
        await feed_manager.stop_all_feeds()
    app.state.feed_manager = None

    logger.info("Application shutdown complete")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=settings.app_description,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        settings.cors_origins
        if isinstance(settings.cors_origins, list)
        else [settings.cors_origins]
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboards.router, prefix="/api")
app.include_router(feeds.router, prefix="/api")
app.include_router(panels.router, prefix="/api")
app.include_router(panels.standalone_router, prefix="/api")
app.include_router(ws_router.router)


@app.get("/health")
def health_check() -> dict[str, str]:
    """Return basic process health and version information."""
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
    }


@app.get("/")
def root() -> dict[str, str]:
    """Return root API discovery information."""
    return {
        "app": settings.app_name,
        "version": settings.app_version,
        "description": settings.app_description,
        "docs": "/docs",
        "health": "/health",
    }
