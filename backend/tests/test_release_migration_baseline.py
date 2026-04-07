from __future__ import annotations

from importlib import import_module
from pathlib import Path

from backend.app.database.base import Base


def test_release_baseline_metadata_matches_live_schema_surface():
    assert "api_keys" in Base.metadata.tables
    assert "import_batches" in Base.metadata.tables
    assert "media" in Base.metadata.tables
    assert "users" in Base.metadata.tables

    import_batches = Base.metadata.tables["import_batches"].c
    media = Base.metadata.tables["media"].c
    users = Base.metadata.tables["users"].c

    assert "recommendation_groups" in import_batches
    assert "recommendations_computed_at" in import_batches
    assert "metadata_review_dismissed" in media
    assert "is_sensitive" in media
    assert "show_sensitive" in users


def test_release_baseline_excludes_reverted_pre_release_schema():
    assert "user_integrations" not in Base.metadata.tables
    assert "anilist_scrape_targets" not in Base.metadata.tables

    baseline_module = import_module("backend.migrations.versions.0001_release_baseline")
    baseline_source = Path(baseline_module.__file__).read_text(encoding="utf-8")

    assert baseline_module.revision == "0001_release_baseline"
    assert "create_all" in baseline_source
    assert "idx_media_entities_type_name" in baseline_source
    assert "fn_bump_version" in baseline_source
    assert "fn_media_tag_after_insert" in baseline_source
    assert "anilist" not in baseline_source
    assert "user_integrations" not in baseline_source
    assert "anilist_scrape_targets" not in baseline_source
