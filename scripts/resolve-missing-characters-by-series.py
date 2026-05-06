#!/usr/bin/env python3
"""Resolve missing character metadata for items that already have series metadata."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MAX_MEDIA_IDS_PER_REQUEST = 500
DEFAULT_INPUT = ".metadata-review/missing-metadata-items.json"
DEFAULT_OUTPUT = ".metadata-review/missing-metadata-character-updates.json"
DEFAULT_ANSWERS = ".metadata-review/missing-metadata-character-answers.json"


@dataclass(frozen=True)
class Assignment:
    media_id: str
    character_names: tuple[str, ...]
    reason: str
    prompt_key: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read missing-metadata-items.json, group items that already have series "
            "metadata by likely character, and write PATCH /media/entities requests."
        )
    )
    parser.add_argument("--input", default=DEFAULT_INPUT, help=f"Source JSON. Default: {DEFAULT_INPUT}")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help=f"Output JSON. Default: {DEFAULT_OUTPUT}")
    parser.add_argument("--answers", default=DEFAULT_ANSWERS, help=f"Reusable answer cache. Default: {DEFAULT_ANSWERS}")
    parser.add_argument("--no-interactive", action="store_true", help="Only use answers already stored in --answers.")
    parser.add_argument("--ask-skipped", action="store_true", help="Ask groups that were previously skipped.")
    parser.add_argument("--limit-questions", type=int, default=None, help="Maximum number of new questions to ask.")
    parser.add_argument("--max-suggestions", type=int, default=6, help="Suggestions to show per group. Default: 6")
    parser.add_argument("--min-confidence", type=float, default=0.5, help="Minimum candidate score for auto-grouping. Default: 0.5")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    answers_path = Path(args.answers)

    try:
        source_payload = load_json_object(input_path)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Could not read {input_path}: {exc}", file=sys.stderr)
        return 1

    items = [item for item in source_payload.get("items", []) if isinstance(item, dict)]
    groups = [group for group in source_payload.get("recommendation_groups", []) if isinstance(group, dict)]
    resolver = CharacterBySeriesResolver(
        items=items,
        groups=groups,
        answers=load_answers(answers_path),
        answers_path=answers_path,
        interactive=not args.no_interactive,
        ask_skipped=args.ask_skipped,
        limit_questions=args.limit_questions,
        max_suggestions=max(args.max_suggestions, 1),
        min_confidence=args.min_confidence,
    )
    assignments = resolver.resolve()
    requests = build_entity_requests(assignments)
    output_payload = build_output_payload(
        source_payload=source_payload,
        input_path=input_path,
        assignments=assignments,
        requests=requests,
        items=items,
        questions_asked=resolver.questions_asked,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(requests)} request(s) covering {len(assignments)} media item(s) to {output_path}")
    if output_payload["summary"]["unresolved_item_count"]:
        print(f"{output_payload['summary']['unresolved_item_count']} review item(s) remain unresolved.")
    return 0


class CharacterBySeriesResolver:
    def __init__(
        self,
        *,
        items: list[dict[str, Any]],
        groups: list[dict[str, Any]],
        answers: dict[str, Any],
        answers_path: Path,
        interactive: bool,
        ask_skipped: bool,
        limit_questions: int | None,
        max_suggestions: int,
        min_confidence: float,
    ) -> None:
        self.items = items
        self.groups_by_media_id = build_groups_by_media_id(groups)
        self.answers = answers
        self.answers_path = answers_path
        self.interactive = interactive
        self.ask_skipped = ask_skipped
        self.limit_questions = limit_questions
        self.max_suggestions = max_suggestions
        self.min_confidence = min_confidence
        self.questions_asked = 0

    def resolve(self) -> list[Assignment]:
        buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
        bucket_metadata: dict[str, dict[str, Any]] = {}

        for item in self.items:
            media_id = get_media_id(item)
            series = series_names(item)
            if (
                media_id is None
                or item.get("missing_character") is not True
                or item.get("missing_series") is True
                or not series
            ):
                continue

            ranked = self.character_suggestions(item)
            if not ranked or ranked[0]["score"] < self.min_confidence:
                continue
            candidate_name = str(ranked[0]["name"])
            key = prompt_key(series, candidate_name)
            buckets[key].append(item)
            bucket_metadata[key] = {
                "series": series,
                "candidate": candidate_name,
            }

        assignments_by_media_id: dict[str, Assignment] = {}
        for key, bucket_items in sorted(buckets.items(), key=lambda item: (-len(item[1]), item[0])):
            target_items = [item for item in bucket_items if get_media_id(item) not in assignments_by_media_id]
            if not target_items:
                continue

            metadata = bucket_metadata[key]
            suggestions = self.aggregate_suggestions(target_items)
            character_names = self.answer_for_bucket(
                key=key,
                series=metadata["series"],
                candidate=metadata["candidate"],
                item_count=len(target_items),
                suggestions=suggestions,
            )
            if not character_names:
                continue

            for item in target_items:
                media_id = get_media_id(item)
                if media_id is None:
                    continue
                assignments_by_media_id[media_id] = Assignment(
                    media_id=media_id,
                    character_names=tuple(character_names),
                    reason="character_by_series_candidate",
                    prompt_key=key,
                )

        return list(assignments_by_media_id.values())

    def answer_for_bucket(
        self,
        *,
        key: str,
        series: list[str],
        candidate: str,
        item_count: int,
        suggestions: list[dict[str, Any]],
    ) -> list[str] | None:
        stored_answers = self.answers.setdefault("character_by_series_candidate", {})
        skipped = set(self.answers.setdefault("skipped_character_by_series_candidate", []))

        if key in stored_answers:
            return list(stored_answers[key])
        if key in skipped and not self.ask_skipped:
            return None
        if not self.interactive:
            return None
        if self.limit_questions is not None and self.questions_asked >= self.limit_questions:
            return None

        self.questions_asked += 1
        print()
        print(f"[{self.questions_asked}] {', '.join(series)} -> {candidate} for {item_count} item(s).")
        if suggestions:
            print("Recommendations:")
            for index, suggestion in enumerate(suggestions, start=1):
                print(f"  {index}. {suggestion['name']} (score {suggestion['score']:.3f}, seen {suggestion['count']}x)")

        prompt = "Character name(s), y=accept, recommendation number, blank=skip, q=quit: "
        try:
            raw_answer = input(prompt)
        except EOFError:
            print()
            return None

        answer = raw_answer.strip()
        if answer.casefold() in {"q", "quit", ":q"}:
            save_answers(self.answers_path, self.answers)
            raise SystemExit(0)
        if not answer:
            self.record_skip(key)
            return None
        if answer.casefold() in {"y", "yes"}:
            answer = candidate

        try:
            character_names = parse_entity_answer(answer, suggestions)
        except ValueError as exc:
            print(f"Skipping {key}: {exc}", file=sys.stderr)
            return None
        if not character_names:
            self.record_skip(key)
            return None

        stored_answers[key] = character_names
        skipped.discard(key)
        self.answers["skipped_character_by_series_candidate"] = sorted(skipped)
        save_answers(self.answers_path, self.answers)
        return character_names

    def record_skip(self, key: str) -> None:
        skipped = set(self.answers.setdefault("skipped_character_by_series_candidate", []))
        skipped.add(key)
        self.answers["skipped_character_by_series_candidate"] = sorted(skipped)
        save_answers(self.answers_path, self.answers)

    def aggregate_suggestions(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        scores: dict[str, float] = defaultdict(float)
        counts: Counter[str] = Counter()
        for item in items:
            for suggestion in self.character_suggestions(item):
                name = suggestion["name"]
                scores[name] += float(suggestion["score"])
                counts[name] += 1
        ranked = sorted(scores, key=lambda name: (-scores[name], -counts[name], normalized_key(name)))
        return [{"name": name, "score": round(scores[name], 3), "count": counts[name]} for name in ranked[: self.max_suggestions]]

    def character_suggestions(self, item: dict[str, Any]) -> list[dict[str, Any]]:
        scores: dict[str, float] = defaultdict(float)
        counts: Counter[str] = Counter()
        add_suggestion_scores(scores, counts, item.get("suggested_characters", []), multiplier=1.0)

        media_id = get_media_id(item)
        if media_id is not None:
            for group in self.groups_by_media_id.get(media_id, []):
                multiplier = max(safe_float(group.get("confidence"), default=1.0), 0.1) * 0.65
                add_suggestion_scores(scores, counts, group.get("suggested_characters", []), multiplier=multiplier)

        ranked = sorted(scores, key=lambda name: (-scores[name], -counts[name], normalized_key(name)))
        return [{"name": name, "score": round(scores[name], 3), "count": counts[name]} for name in ranked[: self.max_suggestions]]


def build_output_payload(
    *,
    source_payload: dict[str, Any],
    input_path: Path,
    assignments: list[Assignment],
    requests: list[dict[str, Any]],
    items: list[dict[str, Any]],
    questions_asked: int,
) -> dict[str, Any]:
    assigned_media_ids = {assignment.media_id for assignment in assignments}
    target_items = [
        item
        for item in items
        if item.get("missing_character") is True and item.get("missing_series") is not True and series_names(item)
    ]
    unresolved = [
        compact_review_item(item)
        for item in target_items
        if get_media_id(item) not in assigned_media_ids
    ]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": str(input_path),
        "source_fetched_at": source_payload.get("fetched_at"),
        "base_url": source_payload.get("base_url"),
        "endpoint": "/media/entities",
        "summary": {
            "source_item_count": len(items),
            "target_item_count": len(target_items),
            "questions_asked": questions_asked,
            "assigned_media_count": len(assignments),
            "request_count": len(requests),
            "unresolved_item_count": len(unresolved),
        },
        "requests": requests,
        "assignments": [
            {
                "media_id": assignment.media_id,
                "character_names": list(assignment.character_names),
                "reason": assignment.reason,
                "prompt_key": assignment.prompt_key,
            }
            for assignment in assignments
        ],
        "unresolved": unresolved,
    }


def build_entity_requests(assignments: list[Assignment]) -> list[dict[str, Any]]:
    grouped_media_ids: dict[tuple[str, ...], list[str]] = defaultdict(list)
    for assignment in assignments:
        grouped_media_ids[assignment.character_names].append(assignment.media_id)

    requests: list[dict[str, Any]] = []
    for character_names, media_ids in sorted(grouped_media_ids.items(), key=lambda item: normalized_key(",".join(item[0]))):
        unique_media_ids = sorted(set(media_ids))
        for chunk in chunks(unique_media_ids, MAX_MEDIA_IDS_PER_REQUEST):
            requests.append(
                {
                    "method": "PATCH",
                    "path": "/media/entities",
                    "body": {
                        "media_ids": chunk,
                        "character_names": list(character_names),
                    },
                }
            )
    return requests


def compact_review_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "batch_item_id": item.get("batch_item_id"),
        "media_id": get_media_id(item),
        "source_filename": item.get("source_filename"),
        "series": series_names(item),
        "suggested_characters": compact_suggestions(item.get("suggested_characters", [])),
    }


def compact_suggestions(suggestions: Any) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    if not isinstance(suggestions, list):
        return compacted
    for suggestion in suggestions[:5]:
        if not isinstance(suggestion, dict):
            continue
        name = suggestion.get("name")
        if isinstance(name, str) and name.strip():
            compacted.append({"name": name.strip(), "confidence": safe_float(suggestion.get("confidence"), default=0.0)})
    return compacted


def build_groups_by_media_id(groups: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    by_media_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for group in groups:
        media_ids = group.get("media_ids")
        if not isinstance(media_ids, list):
            continue
        for media_id in media_ids:
            if isinstance(media_id, str) and media_id:
                by_media_id[media_id].append(group)
    return by_media_id


def add_suggestion_scores(scores: dict[str, float], counts: Counter[str], suggestions: Any, *, multiplier: float) -> None:
    if not isinstance(suggestions, list):
        return
    for suggestion in suggestions:
        if not isinstance(suggestion, dict):
            continue
        name = suggestion.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        clean_name = name.strip()
        scores[clean_name] += safe_float(suggestion.get("confidence"), default=0.0) * multiplier
        counts[clean_name] += 1


def parse_entity_answer(answer: str, suggestions: list[dict[str, Any]]) -> list[str]:
    if answer.casefold() in {"s", "skip", "-"}:
        return []

    names: list[str] = []
    for token in answer.split(","):
        value = token.strip()
        if not value:
            continue
        if value.isdigit():
            index = int(value) - 1
            if index < 0 or index >= len(suggestions):
                raise ValueError(f"recommendation number {value} is out of range")
            value = str(suggestions[index]["name"]).strip()
        if value and normalized_key(value) not in {normalized_key(name) for name in names}:
            names.append(value)
    return names


def prompt_key(series: list[str], candidate_name: str) -> str:
    return f"{' + '.join(series)} :: {candidate_name}"


def series_names(item: dict[str, Any]) -> list[str]:
    return entity_names(item, "series")


def entity_names(item: dict[str, Any], entity_type: str) -> list[str]:
    names: list[str] = []
    entities = item.get("entities")
    if not isinstance(entities, list):
        return names
    seen: set[str] = set()
    for entity in entities:
        if not isinstance(entity, dict) or entity.get("entity_type") != entity_type:
            continue
        name = entity.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        clean_name = name.strip()
        key = normalized_key(clean_name)
        if key in seen:
            continue
        seen.add(key)
        names.append(clean_name)
    return names


def get_media_id(item: dict[str, Any]) -> str | None:
    media = item.get("media")
    if not isinstance(media, dict):
        return None
    media_id = media.get("id")
    return media_id if isinstance(media_id, str) and media_id else None


def normalized_key(value: str) -> str:
    return " ".join(value.strip().casefold().replace("_", " ").split())


def safe_float(value: Any, *, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("top-level JSON value must be an object")
    return payload


def load_answers(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"character_by_series_candidate": {}, "skipped_character_by_series_candidate": []}
    try:
        payload = load_json_object(path)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Ignoring unreadable answer cache {path}: {exc}", file=sys.stderr)
        return {"character_by_series_candidate": {}, "skipped_character_by_series_candidate": []}

    if not isinstance(payload.get("character_by_series_candidate"), dict):
        payload["character_by_series_candidate"] = {}
    if not isinstance(payload.get("skipped_character_by_series_candidate"), list):
        payload["skipped_character_by_series_candidate"] = []
    return payload


def save_answers(path: Path, answers: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(answers, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
