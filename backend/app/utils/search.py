import re


def normalize_metadata_search(value: str | None) -> str:
    if not value:
        return ""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    return normalized.strip("_")


def normalize_character_name_search(value: str | None) -> str:
    return normalize_metadata_search(value)


def escape_like_pattern(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def normalized_token_sequence_like_patterns(normalized_query: str) -> list[str]:
    escaped = escape_like_pattern(normalized_query)
    return [
        f"{escaped}%",
        f"%\\_{escaped}%",
    ]
