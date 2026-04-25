from __future__ import annotations

import math

from backend.app.services.hybrid_similarity import (
    DISCOVERY_SAME_SERIES_PENALTY,
    NORMAL_SAME_SERIES_PENALTY,
    HybridSimilarityScorer,
    MediaSimilarityProfile,
    prototype_confidence,
)


def test_hybrid_similarity_uses_visual_tag_color_weights():
    scorer = HybridSimilarityScorer()
    left = MediaSimilarityProfile(
        embedding=[1.0, 0.0],
        tags={"blonde hair", "armor"},
        color_histogram=[1.0, 0.0],
        support_count=10,
    )
    right = MediaSimilarityProfile(
        embedding=[0.8, 0.6],
        tags={"armor", "sword"},
        color_histogram=[0.5, math.sqrt(0.75)],
        support_count=10,
    )

    score = scorer.score(left, right)

    assert round(score.score, 3) == 0.677
    assert score.breakdown.visual == 0.8
    assert round(score.breakdown.tags or 0, 3) == 0.333
    assert round(score.breakdown.color or 0, 3) == 0.5


def test_same_series_penalty_changes_in_discovery_mode():
    scorer = HybridSimilarityScorer()
    left = MediaSimilarityProfile(embedding=[1.0, 0.0], series_names={"fate"}, support_count=10)
    right = MediaSimilarityProfile(embedding=[1.0, 0.0], series_names={"fate"}, support_count=10)

    normal = scorer.score(left, right, discovery_mode=False)
    discovery = scorer.score(left, right, discovery_mode=True)

    assert normal.breakdown.series_penalty == NORMAL_SAME_SERIES_PENALTY
    assert discovery.breakdown.series_penalty == DISCOVERY_SAME_SERIES_PENALTY
    assert normal.score > discovery.score


def test_prototype_confidence_reaches_full_support_at_ten_images():
    assert round(prototype_confidence(1), 3) == 0.289
    assert prototype_confidence(10) == 1.0
    assert prototype_confidence(30) == 1.0


def test_prototype_profile_uses_top_tags_and_support_count():
    scorer = HybridSimilarityScorer()
    profiles = [
        MediaSimilarityProfile(embedding=[1.0, 0.0], tags={"armor", "sword"}, support_count=1),
        MediaSimilarityProfile(embedding=[0.8, 0.6], tags={"armor", "blue eyes"}, support_count=1),
    ]

    prototype = scorer.prototype_profile(profiles)

    assert prototype.support_count == 2
    assert "armor" in prototype.tags
    assert len(prototype.embedding) == 2
