"""
Logging configuration for Pulseboard.

Provides structured logging using python-json-logger.
"""

import logging
import sys
from typing import Any, Dict

from pythonjsonlogger import jsonlogger

from .config import settings


class CustomJsonFormatter(jsonlogger.JsonFormatter):
    """Custom JSON formatter with additional fields."""

    def add_fields(
        self, log_record: Dict[str, Any], record: logging.LogRecord, message_dict: Dict[str, Any]
    ) -> None:
        """Add custom fields to log record."""
        super().add_fields(log_record, record, message_dict)
        log_record["app"] = settings.app_name
        log_record["version"] = settings.app_version
        log_record["level"] = record.levelname


def setup_logging() -> None:
    """Configure application logging."""
    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, settings.log_level.upper()))

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(getattr(logging, settings.log_level.upper()))

    # Create formatter
    formatter = CustomJsonFormatter(
        "%(timestamp)s %(level)s %(name)s %(message)s",
        rename_fields={"timestamp": "asctime"},
    )

    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # Set third-party loggers to WARNING
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance."""
    return logging.getLogger(name)
