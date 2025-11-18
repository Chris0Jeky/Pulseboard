"""
Main FastAPI application for Pulseboard.

This module initializes the FastAPI app, sets up database, DataHub,
FeedManager, and mounts all routes.
"""

import logging
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

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

# Global instances
hub: DataHub | None = None
feed_manager: FeedManager | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.
    """
    global hub, feed_manager

    logger.info("Starting Pulseboard application...")

    # Create database tables
    create_db_and_tables()
    logger.info("Database initialized")

    # Initialize DataHub
    hub = DataHub(history_window=timedelta(minutes=settings.history_window_minutes))
    logger.info("DataHub initialized")

    # Set hub in WebSocket router
    ws_router.set_hub(hub)

    # Initialize FeedManager
    feed_manager = FeedManager(hub)

    # Load and start feeds
    with Session(engine) as session:
        await feed_manager.load_feeds(session)

    logger.info("Application startup complete")

    yield

    # Shutdown
    logger.info("Shutting down application...")

    if feed_manager:
        await feed_manager.stop_all_feeds()

    logger.info("Application shutdown complete")


# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=settings.app_description,
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins if isinstance(settings.cors_origins, list) else [settings.cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routes
app.include_router(dashboards.router, prefix="/api")
app.include_router(feeds.router, prefix="/api")
app.include_router(panels.router, prefix="/api")
app.include_router(panels.standalone_router, prefix="/api")

# Mount WebSocket routes
app.include_router(ws_router.router)


# Health check endpoint
@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
    }


@app.get("/")
def root():
    """Root endpoint with API information."""
    return {
        "app": settings.app_name,
        "version": settings.app_version,
        "description": settings.app_description,
        "docs": "/docs",
        "health": "/health",
    }
