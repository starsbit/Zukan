from __future__ import annotations

from backend.app.utils.tagging import TagPrediction, TaggingResult, aggregate_tagging_results, derive_character_name, tag_names_mark_nsfw


def test_derive_character_name_uses_highest_confidence_category_4():
    preds = [TagPrediction("safe", 0, 0.9), TagPrediction("Saber", 4, 0.7), TagPrediction("Rin", 4, 0.8)]
    assert derive_character_name(preds) == "Rin"
    assert derive_character_name([TagPrediction("safe", 0, 0.9)]) is None


def test_tag_names_mark_nsfw_by_hint_or_rating():
    assert tag_names_mark_nsfw(["rating:explicit"]) is True
    assert tag_names_mark_nsfw(["Nude"]) is True
    assert tag_names_mark_nsfw(["safe"]) is False


def test_aggregate_tagging_results_keeps_max_confidence_and_nsfw():
    r1 = TaggingResult(predictions=[TagPrediction("a", 0, 0.1), TagPrediction("b", 0, 0.5)], is_nsfw=False)
    r2 = TaggingResult(predictions=[TagPrediction("a", 0, 0.9)], is_nsfw=False)
    merged = aggregate_tagging_results([r1, r2])
    assert [p.name for p in merged.predictions] == ["a", "b"]
    assert merged.predictions[0].confidence == 0.9
    assert merged.is_nsfw is False
