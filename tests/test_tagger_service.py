from app.services.tagger import NSFW_RATING_TAGS


def test_questionable_is_nsfw():
    assert "rating:questionable" in NSFW_RATING_TAGS


def test_explicit_is_nsfw():
    assert "rating:explicit" in NSFW_RATING_TAGS


def test_general_is_not_nsfw():
    assert "rating:general" not in NSFW_RATING_TAGS


def test_sensitive_is_not_nsfw():
    assert "rating:sensitive" not in NSFW_RATING_TAGS


def test_nsfw_set_size():
    assert len(NSFW_RATING_TAGS) == 2
