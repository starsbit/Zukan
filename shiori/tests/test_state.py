from __future__ import annotations

from pathlib import Path

from shiori.app.config import Settings
from shiori.app.state import StateStore


def test_state_store_first_sync_and_repeat(tmp_path: Path):
    store = StateStore(tmp_path / "state.db")
    run_id = store.start_run()
    store.record_item(
        item_key="item-1",
        tweet_id="123",
        media_index=0,
        media_url="https://example.com/a.jpg",
        tweet_url="https://x.com/a/status/123",
        author_handle="a",
        status="imported",
        media_id="mid-1",
    )
    store.finish_run(
        run_id,
        state="idle",
        discovered_count=1,
        imported_count=1,
        skipped_count=0,
        failed_count=0,
        error=None,
    )

    snapshot = store.get_status_snapshot()
    assert snapshot["state"] == "idle"
    assert snapshot["imported_count"] == 1
    assert snapshot["last_successful_sync_at"] is not None
    assert store.should_skip_item("item-1") is True


def test_state_store_partial_failure_retry(tmp_path: Path):
    store = StateStore(tmp_path / "state.db")
    run_id = store.start_run()
    store.record_item(
        item_key="item-1",
        tweet_id="123",
        media_index=0,
        media_url="https://example.com/a.jpg",
        tweet_url="https://x.com/a/status/123",
        author_handle="a",
        status="failed",
        error="boom",
    )
    store.finish_run(
        run_id,
        state="degraded",
        discovered_count=1,
        imported_count=0,
        skipped_count=0,
        failed_count=1,
        error="boom",
    )

    snapshot = store.get_status_snapshot()
    assert snapshot["state"] == "degraded"
    assert snapshot["failed_count"] == 1
    assert store.should_skip_item("item-1") is False


def test_state_store_bootstraps_and_updates_config(tmp_path: Path):
    settings = Settings(
        zukan_base_url="http://api:8000",
        zukan_token="zk",
        twitter_auth_token="auth",
        twitter_ct0="ct0",
        twitter_user_id="123",
        state_db_path=tmp_path / "state.db",
    )
    store = StateStore(tmp_path / "state.db")
    store.bootstrap_config(settings)

    config = store.get_config_read(settings)
    assert config.zukan_base_url == "http://api:8000"
    assert config.has_zukan_token is True
    assert config.has_twitter_auth_token is True
    assert config.has_twitter_ct0 is True

    updated = store.update_config(
        settings,
        {
            "twitter_user_id": "456",
            "default_tags": ["twitter", "likes"],
            "twitter_auth_token": None,
        },
    )
    assert updated.twitter_user_id == "456"
    assert updated.default_tags == ["twitter", "likes"]
    assert updated.has_twitter_auth_token is False


def test_notification_dedupe_uses_cooldown(tmp_path: Path):
    store = StateStore(tmp_path / "state.db")

    assert store.should_send_notification(fingerprint="fp", category="auth_error", cooldown_seconds=3600) is True
    assert store.should_send_notification(fingerprint="fp", category="auth_error", cooldown_seconds=3600) is False
