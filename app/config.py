from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://zukan:zukan@localhost:5432/zukan"

    storage_dir: Path = Path("storage")

    tagger_backend: str = "wd_v3"
    tagger_model_repo: str = "SmilingWolf/wd-vit-tagger-v3"
    tagger_threshold_general: float = 0.35
    tagger_threshold_character: float = 0.85
    model_cache_dir: Path = Path("model_cache")

    max_upload_size_mb: int = 50
    max_batch_size: int = 100
    thumbnail_size: int = 512

    secret_key: str = "change-me-in-production-use-openssl-rand-hex-32"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    remember_me_refresh_token_expire_days: int = 90

    host: str = "0.0.0.0"
    port: int = 8000


settings = Settings()
