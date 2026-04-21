import re


def normalize_metadata_search(value: str | None) -> str:
    if not value:
        return ""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    return normalized.strip("_")


def compact_metadata_search(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", "", value.strip().lower())


def normalize_character_name_search(value: str | None) -> str:
    return normalize_metadata_search(value)
