from app.main import _top_character_name


def test_top_character_name_returns_highest_confidence_character():
    predictions = [
        {"name": "sky", "category": 0, "confidence": 0.92},
        {"name": "ayanami_rei", "category": 4, "confidence": 0.81},
        {"name": "souryuu_asuka_langley", "category": 4, "confidence": 0.95},
    ]

    assert _top_character_name(predictions) == "souryuu_asuka_langley"


def test_top_character_name_returns_none_when_no_character_prediction_exists():
    predictions = [
        {"name": "sky", "category": 0, "confidence": 0.92},
        {"name": "rating:general", "category": 9, "confidence": 0.99},
    ]

    assert _top_character_name(predictions) is None
