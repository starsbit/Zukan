from __future__ import annotations

import logging
import logging.config
import sys


DEFAULT_LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"


class _MediaFileAccessFilter(logging.Filter):
    """Suppress access-log entries for high-frequency media file endpoints."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not (
            '/thumbnail HTTP' in msg
            or '/poster HTTP' in msg
            or '/file HTTP' in msg
        )


def configure_logging(level_name: str = "INFO") -> None:
    level = logging.getLevelName(level_name.upper())
    if not isinstance(level, int):
        level = logging.INFO

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "format": DEFAULT_LOG_FORMAT,
                    "datefmt": "%Y-%m-%dT%H:%M:%S%z",
                },
                "access": {
                    "()": "uvicorn.logging.AccessFormatter",
                    "fmt": '%(asctime)s %(levelname)s [%(name)s] %(client_addr)s - "%(request_line)s" %(status_code)s',
                    "datefmt": "%Y-%m-%dT%H:%M:%S%z",
                    "use_colors": False,
                },
            },
            "handlers": {
                "default": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "stream": "ext://sys.stdout",
                },
                "access": {
                    "class": "logging.StreamHandler",
                    "formatter": "access",
                    "stream": "ext://sys.stdout",
                },
            },
            "root": {
                "level": level,
                "handlers": ["default"],
            },
            "filters": {
                "media_file_access": {
                    "()": "backend.app.logging_config._MediaFileAccessFilter",
                },
            },
            "loggers": {
                "backend": {
                    "level": level,
                    "handlers": ["default"],
                    "propagate": False,
                },
                "uvicorn": {
                    "level": level,
                    "handlers": ["default"],
                    "propagate": False,
                },
                "uvicorn.error": {
                    "level": level,
                    "handlers": ["default"],
                    "propagate": False,
                },
                "uvicorn.access": {
                    "level": level,
                    "handlers": ["access"],
                    "filters": ["media_file_access"],
                    "propagate": False,
                },
            },
        }
    )

    # Ensure the active stdout stream flushes promptly in containers.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(line_buffering=True)
