from __future__ import annotations

import json
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from shiori.app.config import Settings
from shiori.app.models import ConfigRead, RuntimeConfig

CONFIG_PREFIX = "config:"
SECRET_CONFIG_KEYS = {"zukan_token", "twitter_auth_token", "twitter_ct0", "twitter_bearer_token"}


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class StateStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sync_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    state TEXT NOT NULL,
                    discovered_count INTEGER NOT NULL DEFAULT 0,
                    imported_count INTEGER NOT NULL DEFAULT 0,
                    skipped_count INTEGER NOT NULL DEFAULT 0,
                    failed_count INTEGER NOT NULL DEFAULT 0,
                    error TEXT
                );

                CREATE TABLE IF NOT EXISTS synced_items (
                    item_key TEXT PRIMARY KEY,
                    tweet_id TEXT NOT NULL,
                    media_index INTEGER NOT NULL,
                    media_url TEXT NOT NULL,
                    tweet_url TEXT NOT NULL,
                    author_handle TEXT NOT NULL,
                    media_id TEXT,
                    status TEXT NOT NULL,
                    error TEXT,
                    seen_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS notification_events (
                    fingerprint TEXT PRIMARY KEY,
                    category TEXT NOT NULL,
                    last_notified_at TEXT NOT NULL
                );
                """
            )
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def start_run(self) -> int:
        started_at = utc_now()
        with self._lock:
            cursor = self._conn.execute(
                """
                INSERT INTO sync_runs (started_at, state)
                VALUES (?, ?)
                """,
                (started_at, "running"),
            )
            self._conn.execute(
                """
                INSERT INTO metadata (key, value)
                VALUES ('current_state', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
                """,
                ("running",),
            )
            self._conn.commit()
            return int(cursor.lastrowid)

    def finish_run(
        self,
        run_id: int,
        *,
        state: str,
        discovered_count: int,
        imported_count: int,
        skipped_count: int,
        failed_count: int,
        error: str | None,
    ) -> None:
        finished_at = utc_now()
        with self._lock:
            self._conn.execute(
                """
                UPDATE sync_runs
                SET finished_at = ?, state = ?, discovered_count = ?, imported_count = ?,
                    skipped_count = ?, failed_count = ?, error = ?
                WHERE id = ?
                """,
                (finished_at, state, discovered_count, imported_count, skipped_count, failed_count, error, run_id),
            )
            self._conn.execute(
                """
                INSERT INTO metadata (key, value)
                VALUES ('current_state', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
                """,
                (state,),
            )
            if error:
                self._conn.execute(
                    """
                    INSERT INTO metadata (key, value)
                    VALUES ('last_error', ?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value
                    """,
                    (error,),
                )
            else:
                self._conn.execute("DELETE FROM metadata WHERE key = 'last_error'")
            if state == "idle":
                self._conn.execute(
                    """
                    INSERT INTO metadata (key, value)
                    VALUES ('last_successful_sync_at', ?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value
                    """,
                    (finished_at,),
                )
            self._conn.commit()

    def record_item(
        self,
        *,
        item_key: str,
        tweet_id: str,
        media_index: int,
        media_url: str,
        tweet_url: str,
        author_handle: str,
        status: str,
        media_id: str | None = None,
        error: str | None = None,
    ) -> None:
        now = utc_now()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO synced_items (
                    item_key, tweet_id, media_index, media_url, tweet_url, author_handle,
                    media_id, status, error, seen_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(item_key) DO UPDATE SET
                    media_id = excluded.media_id,
                    status = excluded.status,
                    error = excluded.error,
                    updated_at = excluded.updated_at,
                    media_url = excluded.media_url,
                    tweet_url = excluded.tweet_url,
                    author_handle = excluded.author_handle
                """,
                (item_key, tweet_id, media_index, media_url, tweet_url, author_handle, media_id, status, error, now, now),
            )
            self._conn.commit()

    def should_skip_item(self, item_key: str) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT status FROM synced_items WHERE item_key = ?",
                (item_key,),
            ).fetchone()
            return row is not None and row["status"] in {"imported", "duplicate"}

    def get_status_snapshot(self) -> dict[str, Any]:
        with self._lock:
            latest_run = self._conn.execute(
                """
                SELECT started_at, finished_at, state, discovered_count, imported_count,
                       skipped_count, failed_count, error
                FROM sync_runs
                ORDER BY id DESC
                LIMIT 1
                """
            ).fetchone()
            metadata = {
                row["key"]: row["value"]
                for row in self._conn.execute("SELECT key, value FROM metadata").fetchall()
            }
        snapshot = {
            "state": metadata.get("current_state", "idle"),
            "sync_running": metadata.get("current_state") == "running",
            "last_sync_started_at": None,
            "last_sync_finished_at": None,
            "last_successful_sync_at": metadata.get("last_successful_sync_at"),
            "discovered_count": 0,
            "imported_count": 0,
            "skipped_count": 0,
            "failed_count": 0,
            "last_error": metadata.get("last_error"),
        }
        if latest_run is not None:
            snapshot.update(
                {
                    "last_sync_started_at": latest_run["started_at"],
                    "last_sync_finished_at": latest_run["finished_at"],
                    "state": metadata.get("current_state", latest_run["state"]),
                    "discovered_count": latest_run["discovered_count"],
                    "imported_count": latest_run["imported_count"],
                    "skipped_count": latest_run["skipped_count"],
                    "failed_count": latest_run["failed_count"],
                    "last_error": metadata.get("last_error") or latest_run["error"],
                }
            )
            snapshot["sync_running"] = snapshot["state"] == "running"
        return snapshot

    def export_debug_state(self) -> str:
        with self._lock:
            rows = [
                dict(row)
                for row in self._conn.execute(
                    "SELECT item_key, tweet_id, media_index, status, media_id, error FROM synced_items ORDER BY updated_at DESC"
                ).fetchall()
            ]
        return json.dumps(rows)

    def bootstrap_config(self, settings: Settings) -> None:
        defaults = {
            "zukan_base_url": settings.zukan_base_url,
            "zukan_token": settings.zukan_token,
            "twitter_auth_token": settings.twitter_auth_token,
            "twitter_ct0": settings.twitter_ct0,
            "twitter_bearer_token": settings.twitter_bearer_token,
            "twitter_user_id": settings.twitter_user_id,
            "sync_interval_seconds": settings.sync_interval_seconds,
            "default_visibility": settings.default_visibility,
            "default_tags": settings.default_tags,
        }
        with self._lock:
            for key, value in defaults.items():
                prefixed = f"{CONFIG_PREFIX}{key}"
                existing = self._conn.execute(
                    "SELECT value FROM metadata WHERE key = ?",
                    (prefixed,),
                ).fetchone()
                if existing is not None:
                    continue
                self._conn.execute(
                    "INSERT INTO metadata (key, value) VALUES (?, ?)",
                    (prefixed, json.dumps(value)),
                )
            self._conn.commit()

    def get_runtime_config(self, settings: Settings) -> RuntimeConfig:
        self.bootstrap_config(settings)
        with self._lock:
            rows = self._conn.execute(
                "SELECT key, value FROM metadata WHERE key LIKE ?",
                (f"{CONFIG_PREFIX}%",),
            ).fetchall()
        values: dict[str, Any] = {}
        for row in rows:
            key = row["key"][len(CONFIG_PREFIX):]
            try:
                values[key] = json.loads(row["value"])
            except json.JSONDecodeError:
                values[key] = row["value"]
        return RuntimeConfig(
            zukan_base_url=str(values.get("zukan_base_url") or settings.zukan_base_url),
            zukan_token=str(values.get("zukan_token") or ""),
            twitter_auth_token=str(values.get("twitter_auth_token") or ""),
            twitter_ct0=str(values.get("twitter_ct0") or ""),
            twitter_bearer_token=str(values.get("twitter_bearer_token") or ""),
            twitter_user_id=str(values.get("twitter_user_id") or ""),
            sync_interval_seconds=max(60, int(values.get("sync_interval_seconds") or settings.sync_interval_seconds)),
            default_visibility=str(values.get("default_visibility") or settings.default_visibility),
            default_tags=[str(tag) for tag in (values.get("default_tags") or settings.default_tags)],
        )

    def get_config_read(self, settings: Settings) -> ConfigRead:
        config = self.get_runtime_config(settings)
        return ConfigRead(
            zukan_base_url=config.zukan_base_url,
            twitter_user_id=config.twitter_user_id,
            sync_interval_seconds=config.sync_interval_seconds,
            default_visibility=config.default_visibility,
            default_tags=config.default_tags,
            has_zukan_token=bool(config.zukan_token),
            has_twitter_auth_token=bool(config.twitter_auth_token),
            has_twitter_ct0=bool(config.twitter_ct0),
            has_twitter_bearer_token=bool(config.twitter_bearer_token),
        )

    def update_config(self, settings: Settings, changes: dict[str, Any]) -> ConfigRead:
        with self._lock:
            for key, value in changes.items():
                prefixed = f"{CONFIG_PREFIX}{key}"
                if value is None:
                    if key in SECRET_CONFIG_KEYS:
                        self._conn.execute(
                            """
                            INSERT INTO metadata (key, value)
                            VALUES (?, ?)
                            ON CONFLICT(key) DO UPDATE SET value = excluded.value
                            """,
                            (prefixed, json.dumps("")),
                        )
                        continue
                    self._conn.execute("DELETE FROM metadata WHERE key = ?", (prefixed,))
                    continue
                self._conn.execute(
                    """
                    INSERT INTO metadata (key, value)
                    VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    """,
                    (prefixed, json.dumps(value)),
                )
            self._conn.commit()
        return self.get_config_read(settings)

    def should_send_notification(self, *, fingerprint: str, category: str, cooldown_seconds: int) -> bool:
        now = datetime.now(UTC)
        with self._lock:
            row = self._conn.execute(
                "SELECT last_notified_at FROM notification_events WHERE fingerprint = ?",
                (fingerprint,),
            ).fetchone()
            if row is not None:
                last_notified_at = datetime.fromisoformat(row["last_notified_at"])
                if (now - last_notified_at).total_seconds() < cooldown_seconds:
                    return False
            self._conn.execute(
                """
                INSERT INTO notification_events (fingerprint, category, last_notified_at)
                VALUES (?, ?, ?)
                ON CONFLICT(fingerprint) DO UPDATE SET
                    category = excluded.category,
                    last_notified_at = excluded.last_notified_at
                """,
                (fingerprint, category, now.isoformat()),
            )
            self._conn.commit()
            return True
