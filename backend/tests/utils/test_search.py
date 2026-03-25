from __future__ import annotations

from backend.app.utils.search import normalize_character_name_search


def test_normalize_character_name_search():
    assert normalize_character_name_search(None) == ""
    assert normalize_character_name_search("  Saber Alter! ") == "saber_alter"
    assert normalize_character_name_search("@@@") == ""
