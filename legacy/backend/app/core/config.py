"""
Core configuration module for Pulseboard.

Uses pydantic-settings to load configuration from environment variables.
"""

import json

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
    cors_origins: list[str] | str = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:3000",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> list[str] | str:
        """Parse CORS origins from a JSON array, comma-separated string, or list."""
        if isinstance(value, str):
            if value.startswith("["):
                parsed: object = json.loads(value)
                if isinstance(parsed, list) and all(
                    isinstance(origin, str) for origin in parsed
                ):
                    return parsed
                raise ValueError("CORS origins JSON must be an array of strings")
            return [origin.strip() for origin in value.split(",")]
        if isinstance(value, list) and all(isinstance(origin, str) for origin in value):
            return value
        raise ValueError("CORS origins must be a string or list of strings")

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
