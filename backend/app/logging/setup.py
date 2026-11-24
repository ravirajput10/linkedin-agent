"""Logging configuration with credential redaction."""

from __future__ import annotations

import logging
import re
import sys
from typing import Any

from app.config import settings

#: Keys whose values must never reach the logs.
SENSITIVE_KEYS: frozenset[str] = frozenset(
    {
        "password",
        "passwd",
        "secret",
        "secret_key",
        "token",
        "access_token",
        "refresh_token",
        "session_token",
        "api_key",
        "claude_api_key",
        "authorization",
        "cookie",
        "cookies",
        "set-cookie",
        "client_secret",
        "db_password",
    }
)

REDACTED = "***REDACTED***"

_SECRET_PATTERN = re.compile(
    r"(?i)\b(" + "|".join(re.escape(key) for key in sorted(SENSITIVE_KEYS)) + r")\b(\s*[:=]\s*)(\"[^\"]*\"|'[^']*'|\S+)"
)


def redact(value: Any) -> Any:
    """Recursively strip sensitive values out of a structure bound for the logs."""
    if isinstance(value, dict):
        return {
            key: (REDACTED if str(key).lower() in SENSITIVE_KEYS else redact(item))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return type(value)(redact(item) for item in value)
    if isinstance(value, str):
        return _SECRET_PATTERN.sub(lambda m: f"{m.group(1)}{m.group(2)}{REDACTED}", value)
    return value


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.msg)
        if record.args:
            record.args = redact(record.args)
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        import json

        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
        }
        for key in ("campaign_id", "person_id", "workflow_id", "agent", "event"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(settings.log_level.upper())

    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RedactingFilter())
    if settings.log_json:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-8s %(name)s :: %(message)s")
        )
    root.addHandler(handler)

    for noisy in ("httpx", "httpcore", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
