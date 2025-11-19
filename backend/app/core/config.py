"""
Core configuration module for Pulseboard.

Uses pydantic-settings to load configuration from environment variables.
"""

from typing import Any, Dict, List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # API settings
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_reload: bool = False

    # Database settings
    database_url: str = "sqlite:///./pulseboard.db"

    # CORS settings
    cors_origins: List[str] | str = ["http://localhost:5173", "http://localhost:5175", "http://localhost:3000"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Any) -> List[str] | str:
        """Parse CORS origins from string or list."""
        if isinstance(v, str):
            # Handle JSON array string
            if v.startswith("["):
                import json

                return json.loads(v)
            # Handle comma-separated string
            return [origin.strip() for origin in v.split(",")]
        return v

    # Data Hub settings
    history_window_minutes: int = 10

    # Logging
    log_level: str = "INFO"

    # Application metadata
    app_name: str = "Pulseboard"
    app_version: str = "0.1.0"
    app_description: str = "Real-time, pluggable data dashboard"


# Global settings instance
settings = Settings()
