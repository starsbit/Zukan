from pathlib import Path
from typing import Any

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_CONFIG_FILE = Path(__file__).resolve()
_BACKEND_DIR = _CONFIG_FILE.parents[1]
_REPO_ROOT = _CONFIG_FILE.parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            str(_REPO_ROOT / ".env"),
            str(_BACKEND_DIR / ".env"),
            ".env",
        ),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = "postgresql+asyncpg://zukan:zukan@localhost:5432/zukan"

    storage_dir: Path = Path("storage")

    tagger_backend: str = "wd_v3"
    tagger_model_repo: str = "SmilingWolf/wd-vit-tagger-v3"
    tagger_threshold_general: float = 0.35
    tagger_threshold_character: float = 0.85
    model_cache_dir: Path = Path("model_cache")
    tagging_retry_attempts: int = 3
    tagging_retry_backoff_seconds: float = 0.25
    tagging_prediction_timeout_seconds: float = 60.0
    ocr_enabled: bool = True
    ocr_languages: str = "eng"
    ocr_tesseract_config: str = "--psm 6"
    ocr_max_chars: int = 4000
    ocr_sample_frames: int = 5
    embedding_backend: str = "color_histogram_v1"
    embedding_executor_workers: int = 2
    tagging_worker_count: int = 2
    tagger_executor_workers: int = 2
    ocr_executor_workers: int = 2
    library_classification_neighbor_count: int = 12
    library_classification_backfill_limit: int = 64
    library_classification_suggestion_min_similarity: float = 0.55
    library_classification_auto_min_similarity: float = 0.72
    library_classification_auto_high_similarity: float = 0.90
    library_classification_auto_min_margin: float = 0.18
    library_classification_auto_min_support: int = 2

    thumbnail_size: int = 512

    auth_register_rate_limit_requests: int = 10
    auth_register_rate_limit_window_seconds: int = 60
    auth_login_rate_limit_requests: int = 30
    auth_login_rate_limit_window_seconds: int = 60
    auth_refresh_rate_limit_requests: int = 60
    auth_refresh_rate_limit_window_seconds: int = 60
    upload_rate_limit_requests: int = 30
    upload_rate_limit_window_seconds: int = 60
    upload_max_batch_size: int = 1000
    upload_multipart_max_files: int = 1000
    trash_purge_interval_seconds: int = 60 * 60 * 24

    secret_key: str = "change-me-in-production-use-openssl-rand-hex-32"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    remember_me_refresh_token_expire_days: int = 90

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    cors_allowed_origins: list[str] = [
        "http://localhost:4200",
        "http://127.0.0.1:4200",
    ]

    app_version: str = "dev"

    update_poll_interval_seconds: int = 21600
    updater_url: str = Field(
        default="http://updater:8080",
        validation_alias=AliasChoices("UPDATER_URL", "WATCHTOWER_URL"),
    )
    updater_token: str = Field(
        default="",
        validation_alias=AliasChoices("UPDATER_TOKEN", "WATCHTOWER_TOKEN"),
    )


settings = Settings()

RUNTIME_CONFIG_FIELDS = {
    "auth_register_rate_limit_requests",
    "auth_register_rate_limit_window_seconds",
    "auth_login_rate_limit_requests",
    "auth_login_rate_limit_window_seconds",
    "auth_refresh_rate_limit_requests",
    "auth_refresh_rate_limit_window_seconds",
    "upload_rate_limit_requests",
    "upload_rate_limit_window_seconds",
    "access_token_expire_minutes",
    "refresh_token_expire_days",
    "remember_me_refresh_token_expire_days",
    "tagger_threshold_general",
    "tagger_threshold_character",
    "ocr_enabled",
    "ocr_languages",
    "ocr_max_chars",
    "thumbnail_size",
    "trash_purge_interval_seconds",
}


def get_runtime_config() -> dict[str, Any]:
    return {field: getattr(settings, field) for field in sorted(RUNTIME_CONFIG_FIELDS)}


def update_runtime_config(changes: dict[str, Any]) -> dict[str, Any]:
    for field, value in changes.items():
        if field in RUNTIME_CONFIG_FIELDS:
            setattr(settings, field, value)
    return get_runtime_config()
