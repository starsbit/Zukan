from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


@dataclass(slots=True)
class TweetMedia:
    media_index: int
    media_url: str
    media_type: Literal["photo", "video", "animated_gif", "unknown"]
    filename: str
    content_type: str | None = None


@dataclass(slots=True)
class LikedTweet:
    tweet_id: str
    author_handle: str
    tweet_url: str
    created_at: datetime | None
    media: list[TweetMedia]


class SyncTriggerResponse(BaseModel):
    started: bool = Field(description="Whether a new sync run was accepted.")
    state: str = Field(description="Current Shiori state after the trigger request.")
    detail: str = Field(description="Human-readable explanation for the trigger outcome.")


class HealthResponse(BaseModel):
    ok: bool = Field(description="Whether Shiori is ready to sync right now.")
    configured: bool = Field(description="Whether the minimum required config has been provided.")
    state: str = Field(description="Operational state such as unconfigured, idle, running, degraded, or error.")
    zukan_ok: bool = Field(description="Whether the configured Zukan API is currently reachable and authenticated.")
    twitter_ok: bool = Field(description="Whether the configured Twitter/X session appears usable.")
    sync_running: bool = Field(description="Whether a sync job is currently active.")
    issues: list[str] = Field(default_factory=list, description="Current readiness or degradation reasons.")
    last_error: str | None = Field(default=None, description="Last recorded sync or connectivity error.")


class StatusResponse(BaseModel):
    configured: bool = Field(description="Whether Shiori has enough config to perform syncs.")
    state: str = Field(description="Current Shiori state.")
    sync_running: bool = Field(description="Whether a sync is in progress.")
    issues: list[str] = Field(default_factory=list, description="Current readiness or degradation reasons.")
    last_sync_started_at: str | None = Field(default=None, description="When the last sync attempt started.")
    last_sync_finished_at: str | None = Field(default=None, description="When the last sync attempt finished.")
    last_successful_sync_at: str | None = Field(default=None, description="When the last successful sync completed.")
    discovered_count: int = Field(default=0, description="Items discovered during the most recent sync.")
    imported_count: int = Field(default=0, description="Items imported during the most recent sync.")
    skipped_count: int = Field(default=0, description="Items skipped during the most recent sync.")
    failed_count: int = Field(default=0, description="Items that failed during the most recent sync.")
    last_error: str | None = Field(default=None, description="Last recorded sync or connectivity error.")


class ConfigRead(BaseModel):
    zukan_base_url: str = Field(description="Base URL used for the target Zukan API.")
    twitter_user_id: str = Field(description="Numeric Twitter/X user id whose likes will be synced.")
    sync_interval_seconds: int = Field(ge=60, description="Polling interval in seconds between scheduled sync runs.")
    default_visibility: str = Field(description="Visibility applied to uploaded media.")
    default_tags: list[str] = Field(default_factory=list, description="Tags automatically attached to imported media.")
    has_zukan_token: bool = Field(description="Whether a Zukan token has been stored.")
    has_twitter_auth_token: bool = Field(description="Whether a Twitter/X auth_token cookie has been stored.")
    has_twitter_ct0: bool = Field(description="Whether a Twitter/X ct0 cookie has been stored.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "zukan_base_url": "http://api:8000",
                "twitter_user_id": "123456789",
                "sync_interval_seconds": 900,
                "default_visibility": "private",
                "default_tags": ["twitter", "likes"],
                "has_zukan_token": True,
                "has_twitter_auth_token": True,
                "has_twitter_ct0": False,
            }
        }
    }


class ConfigUpdate(BaseModel):
    zukan_base_url: str | None = Field(default=None, description="Override the Zukan API base URL.")
    zukan_token: str | None = Field(default=None, description="Write-only Zukan bearer token or API key. Send null to clear.")
    twitter_auth_token: str | None = Field(default=None, description="Write-only Twitter/X auth_token cookie. Send null to clear.")
    twitter_ct0: str | None = Field(default=None, description="Write-only Twitter/X ct0 cookie. Send null to clear.")
    twitter_user_id: str | None = Field(default=None, description="Numeric Twitter/X user id to sync.")
    sync_interval_seconds: int | None = Field(default=None, ge=60, description="Polling interval in seconds.")
    default_visibility: str | None = Field(default=None, description="Visibility to apply to imported media.")
    default_tags: list[str] | None = Field(default=None, description="Default tags to attach to imported media.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "zukan_base_url": "http://api:8000",
                "twitter_user_id": "123456789",
                "sync_interval_seconds": 1200,
                "default_visibility": "private",
                "default_tags": ["twitter", "likes"],
                "zukan_token": "zk_xxx",
                "twitter_auth_token": "secret-cookie",
                "twitter_ct0": "secret-ct0",
            }
        }
    }


@dataclass(slots=True)
class RuntimeConfig:
    zukan_base_url: str
    zukan_token: str
    twitter_auth_token: str
    twitter_ct0: str
    twitter_user_id: str
    sync_interval_seconds: int
    default_visibility: str
    default_tags: list[str]

    def issues(self) -> list[str]:
        problems: list[str] = []
        if not self.zukan_base_url.strip():
            problems.append("Zukan base URL is not configured.")
        if not self.zukan_token.strip():
            problems.append("Zukan token is not configured.")
        if not self.twitter_auth_token.strip():
            problems.append("Twitter auth_token is not configured.")
        if not self.twitter_ct0.strip():
            problems.append("Twitter ct0 token is not configured.")
        if not self.twitter_user_id.strip():
            problems.append("Twitter user id is not configured.")
        return problems

    @property
    def configured(self) -> bool:
        return not self.issues()
