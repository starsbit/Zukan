from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
import logging
import math
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

from backend.app.models.media import Media
from backend.app.models.relations import MediaEntityType

logger = logging.getLogger(__name__)

CHARACTER_TAG_CATEGORY = 4
SERIES_TAG_CATEGORY = 3
RATING_TAG_CATEGORY = 9
HYBRID_VISUAL_WEIGHT = 0.70
HYBRID_TAG_WEIGHT = 0.20
HYBRID_COLOR_WEIGHT = 0.10
NORMAL_SAME_SERIES_PENALTY = 0.95
DISCOVERY_SAME_SERIES_PENALTY = 0.75
TOP_TAG_LIMIT = 24


@dataclass(frozen=True)
class HybridScoreBreakdown:
    visual: float | None
    tags: float | None
    color: float | None
    confidence: float | None
    series_penalty: float | None


@dataclass(frozen=True)
class HybridScore:
    score: float
    breakdown: HybridScoreBreakdown


@dataclass
class MediaSimilarityProfile:
    embedding: list[float]
    tags: set[str] = field(default_factory=set)
    color_histogram: list[float] = field(default_factory=list)
    series_names: set[str] = field(default_factory=set)
    support_count: int = 1


class HybridSimilarityScorer:
    def __init__(self) -> None:
        self._color_cache: dict[str, list[float]] = {}

    def media_profile(self, media: Media, embedding: list[float]) -> MediaSimilarityProfile:
        return MediaSimilarityProfile(
            embedding=normalized(embedding),
            tags=general_tag_names(media),
            color_histogram=self.color_histogram_for_media(media),
            series_names=series_names(media),
            support_count=1,
        )

    def prototype_profile(self, profiles: Iterable[MediaSimilarityProfile]) -> MediaSimilarityProfile:
        items = list(profiles)
        if not items:
            return MediaSimilarityProfile(embedding=[])

        tag_counts: Counter[str] = Counter()
        all_series: set[str] = set()
        for profile in items:
            tag_counts.update(profile.tags)
            all_series |= profile.series_names

        top_tags = {
            name
            for name, _ in sorted(tag_counts.items(), key=lambda item: (-item[1], item[0]))[:TOP_TAG_LIMIT]
        }
        color_vectors = [profile.color_histogram for profile in items if profile.color_histogram]
        return MediaSimilarityProfile(
            embedding=centroid([profile.embedding for profile in items if profile.embedding]),
            tags=top_tags,
            color_histogram=centroid(color_vectors),
            series_names=all_series,
            support_count=sum(max(1, profile.support_count) for profile in items),
        )

    def score(
        self,
        left: MediaSimilarityProfile,
        right: MediaSimilarityProfile,
        *,
        discovery_mode: bool = False,
        apply_confidence: bool = True,
    ) -> HybridScore:
        visual = cosine_similarity(left.embedding, right.embedding)
        tags = jaccard(left.tags, right.tags)
        color = cosine_similarity(left.color_histogram, right.color_histogram)
        base = (
            HYBRID_VISUAL_WEIGHT * visual
            + HYBRID_TAG_WEIGHT * tags
            + HYBRID_COLOR_WEIGHT * color
        )
        series_penalty = same_series_penalty(left.series_names, right.series_names, discovery_mode=discovery_mode)
        confidence = (
            prototype_confidence(left.support_count) * prototype_confidence(right.support_count)
            if apply_confidence
            else 1.0
        )
        final_score = max(0.0, min(0.999, base * series_penalty * confidence))
        return HybridScore(
            score=final_score,
            breakdown=HybridScoreBreakdown(
                visual=visual,
                tags=tags,
                color=color,
                confidence=confidence,
                series_penalty=series_penalty,
            ),
        )

    def color_histogram_for_media(self, media: Media) -> list[float]:
        path = first_existing_media_image_path(media)
        if path is None:
            return []
        cache_key = str(path)
        if cache_key not in self._color_cache:
            self._color_cache[cache_key] = compute_color_histogram(path)
        return self._color_cache[cache_key]


def normalized(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(float(value) * float(value) for value in vector))
    if norm <= 0:
        return []
    return [float(value) / norm for value in vector]


def centroid(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return []
    length = min(len(vector) for vector in vectors)
    if length <= 0:
        return []
    return normalized([
        sum(vector[index] for vector in vectors) / len(vectors)
        for index in range(length)
    ])


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    limit = min(len(left), len(right))
    return max(0.0, min(1.0, sum(float(left[index]) * float(right[index]) for index in range(limit))))


def jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    union = left | right
    return len(left & right) / len(union) if union else 0.0


def prototype_confidence(support_count: int) -> float:
    return min(1.0, math.log(1 + max(0, support_count)) / math.log(11))


def same_series_penalty(left: set[str], right: set[str], *, discovery_mode: bool) -> float:
    if left and right and left & right:
        return DISCOVERY_SAME_SERIES_PENALTY if discovery_mode else NORMAL_SAME_SERIES_PENALTY
    return 1.0


def general_tag_names(media: Media) -> set[str]:
    names: set[str] = set()
    for media_tag in getattr(media, "media_tags", []) or []:
        tag = getattr(media_tag, "tag", None)
        name = str(getattr(tag, "name", "") or "").strip().casefold()
        category = int(getattr(tag, "category", 0) or 0)
        if not name or category in {CHARACTER_TAG_CATEGORY, SERIES_TAG_CATEGORY, RATING_TAG_CATEGORY}:
            continue
        names.add(name)
    return names


def series_names(media: Media) -> set[str]:
    names: set[str] = set()
    for entity in getattr(media, "entities", []) or []:
        if entity.entity_type != MediaEntityType.series:
            continue
        name = str(entity.name or "").strip().casefold()
        if name:
            names.add(name)
    return names


def first_existing_media_image_path(media: Media) -> Path | None:
    for raw_path in (media.thumbnail_path, media.poster_path, media.filepath):
        if not raw_path:
            continue
        path = Path(raw_path)
        if path.exists() and path.is_file():
            return path
    return None


def compute_color_histogram(path: Path) -> list[float]:
    try:
        with Image.open(path) as image:
            rgb = image.convert("RGB").resize((96, 96), Image.BICUBIC)
            arr = np.asarray(rgb, dtype=np.uint8)

        parts: list[np.ndarray] = []
        for channel in range(3):
            histogram, _ = np.histogram(arr[:, :, channel], bins=16, range=(0, 256))
            parts.append(histogram.astype(np.float32))
        vector = np.concatenate(parts)
        norm = float(np.linalg.norm(vector))
        if norm <= 0:
            return []
        return (vector / norm).astype(np.float32).tolist()
    except Exception as exc:
        logger.debug("Color histogram unavailable path=%s error=%s", path, exc)
        return []
