from __future__ import annotations

from backend.app.utils.media_common import build_tag_payloads, format_tagging_error, normalize_manual_tags, parse_csv_values


def test_parse_csv_values():
    assert parse_csv_values(None) == []
    assert parse_csv_values("a, b ,,c") == ["a", "b", "c"]


def test_normalize_manual_tags_deduplicates_and_trims():
    assert normalize_manual_tags([" a ", "", "a", "b"]) == ["a", "b"]


def test_build_tag_payloads_uses_defaults_and_normalization():
    assert build_tag_payloads(["a", " a ", "b"]) == [("a", 0, 1.0), ("b", 0, 1.0)]


def test_format_tagging_error_caps_length_and_includes_class():
    value = format_tagging_error(RuntimeError("x" * 2000))
    assert value.startswith("RuntimeError:")
    assert len(value) <= 1024
