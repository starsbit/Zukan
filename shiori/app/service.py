from __future__ import annotations

import asyncio
import hashlib
import logging
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from shiori.app.config import Settings
from shiori.app.models import ConfigRead, ConfigUpdate, HealthResponse, RuntimeConfig, StatusResponse, SyncTriggerResponse
from shiori.app.state import StateStore
from shiori.app.twitter_client import TwitterClient
from shiori.app.zukan_client import ZukanClient

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class SyncCounts:
    discovered: int = 0
    imported: int = 0
    skipped: int = 0
    failed: int = 0


class SyncService:
    def __init__(
        self,
        settings: Settings,
        store: StateStore,
        twitter_client: TwitterClient,
        zukan_client: ZukanClient,
    ) -> None:
        self._settings = settings
        self._store = store
        self._twitter_client = twitter_client
        self._zukan_client = zukan_client
        self._lock = asyncio.Lock()
        self._scheduler_task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        self._store.bootstrap_config(self._settings)
        if self._scheduler_task is None:
            self._scheduler_task = asyncio.create_task(self._scheduler())

    async def stop(self) -> None:
        self._stop_event.set()
        if self._scheduler_task is not None:
            self._scheduler_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._scheduler_task
            self._scheduler_task = None
        await self._twitter_client.close()
        await self._zukan_client.close()
        self._store.close()

    async def _scheduler(self) -> None:
        while not self._stop_event.is_set():
            current = self._config()
            await asyncio.sleep(current.sync_interval_seconds)
            if self._lock.locked():
                continue
            if not current.configured:
                continue
            try:
                await self.run_sync()
            except Exception:
                logger.exception("Scheduled sync failed")

    def _item_key(self, tweet_id: str, media_index: int, media_url: str) -> str:
        payload = f"{tweet_id}:{media_index}:{media_url}".encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    async def trigger_sync(self) -> SyncTriggerResponse:
        if self._lock.locked():
            return SyncTriggerResponse(started=False, state="running", detail="A sync is already running")
        if not self._config().configured:
            return SyncTriggerResponse(started=False, state="unconfigured", detail="Shiori is not configured yet")
        asyncio.create_task(self.run_sync())
        return SyncTriggerResponse(started=True, state="running", detail="Sync started")

    async def run_sync(self) -> None:
        async with self._lock:
            config = self._config()
            if not config.configured:
                raise RuntimeError("Shiori is not configured yet")
            run_id = self._store.start_run()
            counts = SyncCounts()
            final_state = "idle"
            final_error: str | None = None
            try:
                liked_tweets = await self._twitter_client.fetch_liked_tweets(config)
                for tweet in liked_tweets:
                    for media in tweet.media:
                        counts.discovered += 1
                        item_key = self._item_key(tweet.tweet_id, media.media_index, media.media_url)
                        if self._store.should_skip_item(item_key):
                            counts.skipped += 1
                            continue
                        try:
                            content = await self._twitter_client.download_media(media.media_url)
                            content_type = media.content_type or "application/octet-stream"
                            result = await self._zukan_client.upload_media(
                                config=config,
                                filename=media.filename,
                                content=content,
                                content_type=content_type,
                                visibility=config.default_visibility,
                                tags=config.default_tags,
                            )
                            media_id = result.get("id")
                            if not media_id:
                                raise RuntimeError("Zukan upload result did not include a media id")
                            await self._zukan_client.attach_external_ref(
                                config=config,
                                media_id=media_id,
                                provider="twitter",
                                external_id=tweet.tweet_id,
                                url=tweet.tweet_url,
                            )
                            status = "duplicate" if result.get("status") == "duplicate" else "imported"
                            if status == "duplicate":
                                counts.skipped += 1
                            else:
                                counts.imported += 1
                            self._store.record_item(
                                item_key=item_key,
                                tweet_id=tweet.tweet_id,
                                media_index=media.media_index,
                                media_url=media.media_url,
                                tweet_url=tweet.tweet_url,
                                author_handle=tweet.author_handle,
                                status=status,
                                media_id=media_id,
                            )
                        except Exception as exc:
                            counts.failed += 1
                            self._store.record_item(
                                item_key=item_key,
                                tweet_id=tweet.tweet_id,
                                media_index=media.media_index,
                                media_url=media.media_url,
                                tweet_url=tweet.tweet_url,
                                author_handle=tweet.author_handle,
                                status="failed",
                                error=str(exc),
                            )
                            await self._handle_sync_issue(
                                config=config,
                                category=self._categorize_exception(exc, stage="media_download" if "download" in str(exc).casefold() else "media_ingest"),
                                message=str(exc),
                                tweet_id=tweet.tweet_id,
                                media_url=media.media_url,
                            )
                            logger.warning("Failed to ingest tweet media tweet_id=%s media_index=%s error=%s", tweet.tweet_id, media.media_index, exc)
            except Exception as exc:
                final_state = "error"
                final_error = str(exc)
                await self._handle_sync_issue(
                    config=config,
                    category=self._categorize_exception(exc, stage="likes_fetch"),
                    message=str(exc),
                )
                logger.exception("Sync run failed")
            else:
                if counts.failed:
                    final_state = "degraded"
                    final_error = f"{counts.failed} item(s) failed in the last run"
            self._store.finish_run(
                run_id,
                state=final_state,
                discovered_count=counts.discovered,
                imported_count=counts.imported,
                skipped_count=counts.skipped,
                failed_count=counts.failed,
                error=final_error,
            )

    def _config(self) -> RuntimeConfig:
        return self._store.get_runtime_config(self._settings)

    def get_config(self) -> ConfigRead:
        return self._store.get_config_read(self._settings)

    def update_config(self, payload: ConfigUpdate) -> ConfigRead:
        changes: dict[str, Any] = {}
        for field in payload.model_fields_set:
            changes[field] = getattr(payload, field)
        return self._store.update_config(self._settings, changes)

    async def get_health(self) -> HealthResponse:
        config = self._config()
        snapshot = self._status_snapshot(config)
        zukan_ok = False
        twitter_ok = False
        if config.configured:
            zukan_ok, twitter_ok = await asyncio.gather(
                self._zukan_client.probe(config),
                self._twitter_client.probe(config),
            )
        issues = list(config.issues())
        if config.configured and not zukan_ok:
            issues.append("Configured Zukan API is not reachable or authentication failed.")
        if config.configured and not twitter_ok:
            issues.append("Twitter/X is not reachable or the stored session is invalid.")
        if snapshot["state"] == "error" and snapshot["last_error"]:
            issues.append(snapshot["last_error"])
        ok = config.configured and zukan_ok and twitter_ok and snapshot["state"] != "error"
        return HealthResponse(
            ok=ok,
            configured=config.configured,
            state=snapshot["state"],
            zukan_ok=zukan_ok,
            twitter_ok=twitter_ok,
            sync_running=self._lock.locked(),
            issues=issues,
            last_error=snapshot["last_error"],
        )

    def get_status(self) -> StatusResponse:
        config = self._config()
        snapshot = self._status_snapshot(config)
        snapshot["sync_running"] = self._lock.locked()
        return StatusResponse(**snapshot)

    def _status_snapshot(self, config: RuntimeConfig) -> dict[str, Any]:
        snapshot = self._store.get_status_snapshot()
        issues = config.issues()
        if not config.configured:
            snapshot["state"] = "unconfigured"
        snapshot["configured"] = config.configured
        snapshot["issues"] = issues
        return snapshot

    def _categorize_exception(self, exc: Exception, *, stage: str) -> str:
        message = str(exc).casefold()
        if "401" in message or "403" in message or "invalid token" in message or "auth" in message:
            return "auth_error" if stage.startswith("likes") else "zukan_auth_error"
        if "parse" in message or "json" in message:
            return "parsing_error"
        if "download" in stage:
            return "media_download_error"
        if stage.startswith("likes"):
            return "twitter_unreachable"
        return "sync_error"

    async def _handle_sync_issue(
        self,
        *,
        config: RuntimeConfig,
        category: str,
        message: str,
        tweet_id: str | None = None,
        media_url: str | None = None,
    ) -> None:
        if not config.zukan_token or not config.zukan_base_url:
            return
        fingerprint_source = f"{category}:{tweet_id or ''}:{media_url or ''}:{message[:200]}"
        fingerprint = hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest()
        if not self._store.should_send_notification(
            fingerprint=fingerprint,
            category=category,
            cooldown_seconds=self._settings.notification_cooldown_seconds,
        ):
            return
        try:
            occurred_at = datetime.now(UTC).isoformat()
            body = message if len(message) < 512 else f"{message[:509]}..."
            await self._zukan_client.send_admin_notification(
                config=config,
                title=f"Shiori alert: {category.replace('_', ' ')}",
                body=body,
                link_url=None,
                data={
                    "kind": "shiori_alert",
                    "category": category,
                    "tweet_id": tweet_id,
                    "media_url": media_url,
                    "occurred_at": occurred_at,
                },
            )
        except Exception:
            logger.exception("Failed to publish Shiori alert to Zukan")
