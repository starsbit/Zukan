from __future__ import annotations


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


def build_tag_payloads(
    tag_names: list[str],
    *,
    default_category: int = 0,
    default_confidence: float = 1.0,
) -> list[tuple[str, int, float]]:
    return [(tag_name, default_category, default_confidence) for tag_name in normalize_manual_tags(tag_names)]


def format_tagging_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return f"{exc.__class__.__name__}: {message}"[:1024]
