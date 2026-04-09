from __future__ import annotations

from pathlib import Path

from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env",),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "shiori"
    host: str = "0.0.0.0"
    port: int = 8010
    log_level: str = "INFO"
    sync_interval_seconds: int = 900
    request_timeout_seconds: float = 30.0
    notification_cooldown_seconds: int = Field(
        default=60 * 60 * 6,
        validation_alias=AliasChoices("SHIORI_NOTIFICATION_COOLDOWN_SECONDS", "NOTIFICATION_COOLDOWN_SECONDS"),
    )
    state_db_path: Path = Path("/data/shiori.db")
    default_visibility: str = "private"
    default_tags: list[str] = Field(default_factory=list)

    zukan_base_url: str = "http://api:8000"
    zukan_token: str = ""

    twitter_auth_token: str = ""
    twitter_ct0: str = ""
    twitter_bearer_token: str = ""
    twitter_user_id: str = ""
    twitter_likes_query_id: str = "nI8MO6A28zU6dgVq-1KjVw"
    twitter_max_pages_per_run: int = 10
    twitter_page_size: int = 20
    twitter_api_base_url: str = "https://x.com"


settings = Settings()
