from __future__ import annotations

from backend.app.utils.search import normalize_metadata_search


def parse_csv_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def normalize_manual_tags(tags: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        cleaned = tag.strip()
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def normalize_manual_entity_names(names: list[str] | None) -> list[str]:
    if not names:
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for name in names:
        cleaned = name.strip()
        if not cleaned:
            continue
        key = normalize_metadata_search(cleaned) or cleaned.casefold()
        if key in seen:
            continue
        normalized.append(cleaned)
        seen.add(key)
    return normalized


def build_tag_payloads(
    tag_names: list[str],
    *,
    default_category: int = 0,
    default_confidence: float = 1.0,
) -> list[tuple[str, int, float]]:
    return [(tag_name, default_category, default_confidence) for tag_name in normalize_manual_tags(tag_names)]


def limit_error_message(message: str, *, max_length: int = 1024) -> str:
    cleaned = message.strip()
    if not cleaned:
        cleaned = "Unknown error"
    return cleaned[:max_length]


def format_tagging_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return limit_error_message(f"{exc.__class__.__name__}: {message}")
