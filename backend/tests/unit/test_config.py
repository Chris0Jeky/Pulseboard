"""
Unit tests for configuration module.
"""

import json
import os
from unittest.mock import patch

import pytest

from app.core.config import Settings


def test_settings_defaults():
    """Test that default settings are loaded correctly."""
    settings = Settings()

    assert settings.api_host == "0.0.0.0"
    assert settings.api_port == 8000
    assert settings.api_reload is False
    assert settings.database_url == "sqlite:///./pulseboard.db"
    assert settings.history_window_minutes == 10
    assert settings.log_level == "INFO"
    assert settings.app_name == "Pulseboard"


def test_settings_from_env():
    """Test that settings can be loaded from environment variables."""
    env_vars = {
        "API_HOST": "127.0.0.1",
        "API_PORT": "9000",
        "API_RELOAD": "true",
        "DATABASE_URL": "sqlite:///./test.db",
        "LOG_LEVEL": "DEBUG",
    }

    with patch.dict(os.environ, env_vars, clear=False):
        settings = Settings()

        assert settings.api_host == "127.0.0.1"
        assert settings.api_port == 9000
        assert settings.api_reload is True
        assert settings.database_url == "sqlite:///./test.db"
        assert settings.log_level == "DEBUG"


def test_cors_origins_list():
    """Test CORS origins as list."""
    settings = Settings(cors_origins=["http://example.com", "http://test.com"])

    assert settings.cors_origins == ["http://example.com", "http://test.com"]


def test_cors_origins_json_string():
    """Test CORS origins as JSON array string."""
    json_string = json.dumps(["http://example.com", "http://test.com"])
    settings = Settings(cors_origins=json_string)

    assert settings.cors_origins == ["http://example.com", "http://test.com"]


def test_cors_origins_comma_separated():
    """Test CORS origins as comma-separated string."""
    settings = Settings(cors_origins="http://example.com, http://test.com")

    assert settings.cors_origins == ["http://example.com", "http://test.com"]
