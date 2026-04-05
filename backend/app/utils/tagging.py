from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

NSFW_RATING_TAGS = {"rating:questionable", "rating:explicit"}
NSFW_HINT_TAGS = {
    "nsfw",
    "explicit",
    "questionable",
    "nude",
    "nudity",
    "breasts",
    "large_breasts",
    "small_breasts",
    "ass",
    "underboob",
    "sideboob",
    "cameltoe",
    "panties",
    "lingerie",
    "sexually_suggestive",
    "nipples",
    "areolae",
    "penis",
    "pussy",
    "vagina",
    "sex",
    "censored",
    "uncensored",
}


@dataclass(frozen=True)
class TagPrediction:
    name: str
    category: int
    confidence: float


@dataclass(frozen=True)
class TaggingResult:
    predictions: list[TagPrediction]
    is_nsfw: bool


class TaggerBackend(Protocol):
    def load(self) -> None: ...
    async def predict(self, image_path: str) -> TaggingResult: ...


def derive_character_name(predictions: list[TagPrediction]) -> str | None:
    character_predictions = [p for p in predictions if p.category == 4]
    if not character_predictions:
        return None
    return max(character_predictions, key=lambda p: p.confidence).name


def extract_series_name_from_character_tag(character_name: str) -> str | None:
    match = re.match(r"^.+?_\(([^()]+)\)$", character_name.strip())
    if match is None:
        return None
    series_name = match.group(1).strip()
    return series_name or None


def derive_series_predictions(predictions: list[TagPrediction]) -> list[TagPrediction]:
    series_by_name: dict[str, TagPrediction] = {}

    def _store(prediction: TagPrediction) -> None:
        key = prediction.name.casefold()
        existing = series_by_name.get(key)
        if existing is None or prediction.confidence > existing.confidence:
            series_by_name[key] = prediction

    for prediction in predictions:
        if prediction.category == 3:
            _store(prediction)
            continue
        if prediction.category != 4:
            continue
        series_name = extract_series_name_from_character_tag(prediction.name)
        if series_name is not None:
            _store(TagPrediction(name=series_name, category=3, confidence=prediction.confidence))

    return sorted(series_by_name.values(), key=lambda p: p.confidence, reverse=True)


def tag_names_mark_nsfw(tag_names: list[str]) -> bool:
    normalized = {t.strip().lower() for t in tag_names if t.strip()}
    return bool(normalized & NSFW_RATING_TAGS or normalized & NSFW_HINT_TAGS)


def aggregate_tagging_results(results: list[TaggingResult]) -> TaggingResult:
    tag_map: dict[str, TagPrediction] = {}
    for result in results:
        for prediction in result.predictions:
            existing = tag_map.get(prediction.name)
            if existing is None or prediction.confidence > existing.confidence:
                tag_map[prediction.name] = prediction
    predictions = sorted(tag_map.values(), key=lambda p: p.confidence, reverse=True)
    return TaggingResult(
        predictions=predictions,
        is_nsfw=any(r.is_nsfw for r in results) or tag_names_mark_nsfw([p.name for p in predictions]),
    )
