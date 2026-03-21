from backend.app.services.tagger import TagPrediction, TaggingResult


def test_tagging_result_can_carry_character_name():
    result = TaggingResult(
        predictions=[
            TagPrediction(name="souryuu_asuka_langley", category=4, confidence=0.95),
            TagPrediction(name="sky", category=0, confidence=0.82),
        ],
        character_name="souryuu_asuka_langley",
        is_nsfw=False,
    )

    assert result.character_name == "souryuu_asuka_langley"
    assert [prediction.name for prediction in result.predictions] == ["souryuu_asuka_langley", "sky"]


def test_tagging_result_allows_missing_character_name():
    result = TaggingResult(
        predictions=[TagPrediction(name="forest", category=0, confidence=0.91)],
        character_name=None,
        is_nsfw=False,
    )

    assert result.character_name is None
