from __future__ import annotations

from backend.app.utils.search import compact_metadata_search, normalize_character_name_search


def test_normalize_character_name_search():
    assert normalize_character_name_search(None) == ""
    assert normalize_character_name_search("  Saber Alter! ") == "saber_alter"
    assert normalize_character_name_search("@@@") == ""


def test_compact_metadata_search():
    assert compact_metadata_search(None) == ""
    assert compact_metadata_search("Jeanne D'arc (Fate)") == "jeannedarcfate"
    assert compact_metadata_search("@@@") == ""
