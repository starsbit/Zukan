from backend.app.services.tagger import TagPrediction, TaggingResult


def test_tagging_result_stores_predictions_and_nsfw_flag():
    result = TaggingResult(
        predictions=[
            TagPrediction(name="souryuu_asuka_langley", category=4, confidence=0.95),
            TagPrediction(name="sky", category=0, confidence=0.82),
        ],
        is_nsfw=False,
    )

    assert [prediction.name for prediction in result.predictions] == ["souryuu_asuka_langley", "sky"]
    assert result.is_nsfw is False
