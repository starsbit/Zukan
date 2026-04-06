from __future__ import annotations

from backend.app.utils.tagging import (
    TagPrediction,
    TaggingResult,
    aggregate_tagging_results,
    derive_character_name,
    derive_series_predictions,
    extract_series_name_from_character_tag,
    tag_names_mark_sensitive,
    tag_names_mark_nsfw,
)


def test_derive_character_name_uses_highest_confidence_category_4():
    preds = [TagPrediction("safe", 0, 0.9), TagPrediction("Saber", 4, 0.7), TagPrediction("Rin", 4, 0.8)]
    assert derive_character_name(preds) == "Rin"
    assert derive_character_name([TagPrediction("safe", 0, 0.9)]) is None


def test_tag_names_mark_nsfw_by_hint_or_rating():
    assert tag_names_mark_nsfw(["rating:explicit"]) is True
    assert tag_names_mark_nsfw(["questionable"]) is True
    assert tag_names_mark_nsfw(["Nude"]) is True
    assert tag_names_mark_nsfw(["safe"]) is False


def test_tag_names_mark_sensitive_by_curated_hint():
    assert tag_names_mark_sensitive(["sensitive"]) is True
    assert tag_names_mark_sensitive(["panties"]) is True
    assert tag_names_mark_sensitive(["Lingerie"]) is True
    assert tag_names_mark_sensitive(["safe"]) is False


def test_extract_series_name_from_character_tag():
    assert extract_series_name_from_character_tag("kanna_(blue_archive)") == "blue_archive"
    assert extract_series_name_from_character_tag("saber") is None


def test_derive_series_predictions_uses_explicit_and_character_suffixes():
    predictions = [
        TagPrediction("kanna_(blue_archive)", 4, 0.91),
        TagPrediction("hoshino_(blue_archive)", 4, 0.88),
        TagPrediction("blue_archive", 3, 0.42),
        TagPrediction("safe", 0, 0.99),
    ]

    assert derive_series_predictions(predictions) == [TagPrediction("blue_archive", 3, 0.91)]


def test_aggregate_tagging_results_keeps_max_confidence_and_nsfw():
    r1 = TaggingResult(predictions=[TagPrediction("a", 0, 0.1), TagPrediction("b", 0, 0.5)], is_nsfw=False)
    r2 = TaggingResult(predictions=[TagPrediction("a", 0, 0.9)], is_nsfw=False)
    merged = aggregate_tagging_results([r1, r2])
    assert [p.name for p in merged.predictions] == ["a", "b"]
    assert merged.predictions[0].confidence == 0.9
    assert merged.is_nsfw is False


def test_aggregate_tagging_results_keeps_sensitive_state():
    merged = aggregate_tagging_results([
        TaggingResult(predictions=[TagPrediction("safe", 0, 0.7)], is_nsfw=False),
        TaggingResult(predictions=[TagPrediction("panties", 0, 0.9)], is_nsfw=False),
    ])

    assert merged.is_sensitive is True
