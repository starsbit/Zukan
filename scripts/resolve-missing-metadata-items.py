#!/usr/bin/env python3
"""Interactively turn downloaded missing metadata review items into API updates."""

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
DEFAULT_OUTPUT = ".metadata-review/missing-metadata-entity-updates.json"
DEFAULT_ANSWERS = ".metadata-review/missing-metadata-answers.json"


@dataclass(frozen=True)
class Assignment:
    media_id: str
    series_names: tuple[str, ...]
    reason: str
    prompt_key: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read missing-metadata-items.json, ask for compact manual answers, "
            "and write request bodies for PATCH /media/entities."
        )
    )
    parser.add_argument(
        "--input",
        default=DEFAULT_INPUT,
        help=f"Downloaded missing metadata JSON. Default: {DEFAULT_INPUT}",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Output JSON containing compact API request bodies. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--answers",
        default=DEFAULT_ANSWERS,
        help=f"Reusable answer cache. Default: {DEFAULT_ANSWERS}",
    )
    parser.add_argument(
        "--no-interactive",
        action="store_true",
        help="Do not ask questions; only use answers already stored in --answers.",
    )
    parser.add_argument(
        "--ask-skipped",
        action="store_true",
        help="Ask questions that were previously skipped in the answer cache.",
    )
    parser.add_argument(
        "--limit-questions",
        type=int,
        default=None,
        help="Maximum number of new questions to ask in this run.",
    )
    parser.add_argument(
        "--max-suggestions",
        type=int,
        default=5,
        help="Maximum recommendations to show per question. Default: 5",
    )
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

    answers = load_answers(answers_path)
    items = [item for item in source_payload.get("items", []) if isinstance(item, dict)]
    groups = [group for group in source_payload.get("recommendation_groups", []) if isinstance(group, dict)]

    resolver = SeriesByCharacterResolver(
        items=items,
        groups=groups,
        answers=answers,
        answers_path=answers_path,
        interactive=not args.no_interactive,
        ask_skipped=args.ask_skipped,
        limit_questions=args.limit_questions,
        max_suggestions=max(args.max_suggestions, 1),
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

    print(
        f"Wrote {len(requests)} request(s) covering {len(assignments)} media item(s) to {output_path}"
    )
    unresolved_count = len(output_payload["unresolved"])
    if unresolved_count:
        print(f"{unresolved_count} review item(s) remain unresolved in the compact output.")
    return 0


class SeriesByCharacterResolver:
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
    ) -> None:
        self.items = items
        self.groups = groups
        self.answers = answers
        self.answers_path = answers_path
        self.interactive = interactive
        self.ask_skipped = ask_skipped
        self.limit_questions = limit_questions
        self.max_suggestions = max_suggestions
        self.questions_asked = 0

        self.items_by_media_id = {
            media_id: item
            for item in self.items
            if (media_id := get_media_id(item)) is not None
        }
        self.groups_by_media_id = build_groups_by_media_id(self.groups)

    def resolve(self) -> list[Assignment]:
        only_series_items = [
            item
            for item in self.items
            if item.get("missing_series") is True
            and item.get("missing_character") is not True
            and get_media_id(item) is not None
            and character_names(item)
        ]
        character_buckets = build_character_buckets(only_series_items)
        character_order = sorted(
            character_buckets,
            key=lambda name: (-len(character_buckets[name]), normalized_key(name)),
        )

        assignments_by_media_id: dict[str, Assignment] = {}
        for character_name in character_order:
            target_ids = [
                media_id
                for media_id in character_buckets[character_name]
                if media_id not in assignments_by_media_id
            ]
            if not target_ids:
                continue

            series_names = self.answer_for_character(character_name, target_ids)
            if not series_names:
                continue

            for media_id in target_ids:
                assignments_by_media_id[media_id] = Assignment(
                    media_id=media_id,
                    series_names=tuple(series_names),
                    reason="series_by_character",
                    prompt_key=character_name,
                )

        return list(assignments_by_media_id.values())

    def answer_for_character(self, character_name: str, media_ids: list[str]) -> list[str] | None:
        stored_answers = self.answers.setdefault("series_by_character", {})
        skipped = set(self.answers.setdefault("skipped_series_by_character", []))

        if character_name in stored_answers:
            return list(stored_answers[character_name])
        if character_name in skipped and not self.ask_skipped:
            return None
        if not self.interactive:
            return None
        if self.limit_questions is not None and self.questions_asked >= self.limit_questions:
            return None

        suggestions = self.series_suggestions(media_ids)
        co_characters = self.co_characters(character_name, media_ids)
        self.questions_asked += 1

        print()
        print(
            f"[{self.questions_asked}] {character_name} appears in "
            f"{len(media_ids)} unresolved series-only item(s)."
        )
        if co_characters:
            print("Other characters in these items: " + format_counter(co_characters, limit=8))
        if suggestions:
            print("Recommendations:")
            for index, suggestion in enumerate(suggestions, start=1):
                print(
                    f"  {index}. {suggestion['name']} "
                    f"(score {suggestion['score']:.3f}, seen {suggestion['count']}x)"
                )

        prompt = "Series name(s), recommendation number, blank=skip, q=quit: "
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
            self.record_skip(character_name)
            return None

        try:
            series_names = parse_entity_answer(answer, suggestions)
        except ValueError as exc:
            print(f"Skipping {character_name}: {exc}", file=sys.stderr)
            return None
        if not series_names:
            self.record_skip(character_name)
            return None

        stored_answers[character_name] = series_names
        skipped.discard(character_name)
        self.answers["skipped_series_by_character"] = sorted(skipped)
        save_answers(self.answers_path, self.answers)
        return series_names

    def record_skip(self, character_name: str) -> None:
        skipped = set(self.answers.setdefault("skipped_series_by_character", []))
        skipped.add(character_name)
        self.answers["skipped_series_by_character"] = sorted(skipped)
        save_answers(self.answers_path, self.answers)

    def series_suggestions(self, media_ids: list[str]) -> list[dict[str, Any]]:
        scores: dict[str, float] = defaultdict(float)
        counts: Counter[str] = Counter()

        for media_id in media_ids:
            item = self.items_by_media_id.get(media_id)
            if item is not None:
                add_suggestion_scores(scores, counts, item.get("suggested_series", []), multiplier=1.0)

            seen_group_ids: set[str] = set()
            for group in self.groups_by_media_id.get(media_id, []):
                group_id = str(group.get("id") or "")
                if group_id in seen_group_ids:
                    continue
                seen_group_ids.add(group_id)
                confidence = safe_float(group.get("confidence"), default=1.0)
                add_suggestion_scores(
                    scores,
                    counts,
                    group.get("suggested_series", []),
                    multiplier=max(confidence, 0.1),
                )

        ranked = sorted(scores, key=lambda name: (-scores[name], -counts[name], normalized_key(name)))
        return [
            {"name": name, "score": round(scores[name], 3), "count": counts[name]}
            for name in ranked[: self.max_suggestions]
        ]

    def co_characters(self, character_name: str, media_ids: list[str]) -> Counter[str]:
        counter: Counter[str] = Counter()
        for media_id in media_ids:
            item = self.items_by_media_id.get(media_id)
            if item is None:
                continue
            for name in character_names(item):
                if normalized_key(name) != normalized_key(character_name):
                    counter[name] += 1
        return counter


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
    unresolved = [
        compact_review_item(item)
        for item in items
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
            "questions_asked": questions_asked,
            "assigned_media_count": len(assignments),
            "request_count": len(requests),
            "unresolved_item_count": len(unresolved),
        },
        "requests": requests,
        "assignments": [
            {
                "media_id": assignment.media_id,
                "series_names": list(assignment.series_names),
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
        grouped_media_ids[assignment.series_names].append(assignment.media_id)

    requests: list[dict[str, Any]] = []
    for series_names, media_ids in sorted(grouped_media_ids.items(), key=lambda item: normalized_key(",".join(item[0]))):
        unique_media_ids = sorted(set(media_ids))
        for chunk in chunks(unique_media_ids, MAX_MEDIA_IDS_PER_REQUEST):
            requests.append(
                {
                    "method": "PATCH",
                    "path": "/media/entities",
                    "body": {
                        "media_ids": chunk,
                        "series_names": list(series_names),
                    },
                }
            )
    return requests


def compact_review_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "batch_item_id": item.get("batch_item_id"),
        "media_id": get_media_id(item),
        "source_filename": item.get("source_filename"),
        "missing_character": item.get("missing_character"),
        "missing_series": item.get("missing_series"),
        "characters": character_names(item),
        "series": series_names(item),
        "suggested_characters": compact_suggestions(item.get("suggested_characters", [])),
        "suggested_series": compact_suggestions(item.get("suggested_series", [])),
    }


def compact_suggestions(suggestions: Any) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    if not isinstance(suggestions, list):
        return compacted
    for suggestion in suggestions[:5]:
        if not isinstance(suggestion, dict):
            continue
        name = suggestion.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        compacted.append(
            {
                "name": name.strip(),
                "confidence": safe_float(suggestion.get("confidence"), default=0.0),
            }
        )
    return compacted


def build_character_buckets(items: list[dict[str, Any]]) -> dict[str, list[str]]:
    buckets: dict[str, list[str]] = defaultdict(list)
    for item in items:
        media_id = get_media_id(item)
        if media_id is None:
            continue
        for character_name in character_names(item):
            buckets[character_name].append(media_id)
    return buckets


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


def add_suggestion_scores(
    scores: dict[str, float],
    counts: Counter[str],
    suggestions: Any,
    *,
    multiplier: float,
) -> None:
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


def format_counter(counter: Counter[str], *, limit: int) -> str:
    return ", ".join(f"{name} ({count})" for name, count in counter.most_common(limit))


def character_names(item: dict[str, Any]) -> list[str]:
    return entity_names(item, "character")


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
    if isinstance(media_id, str) and media_id:
        return media_id
    return None


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
        return {"series_by_character": {}, "skipped_series_by_character": []}
    try:
        payload = load_json_object(path)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Ignoring unreadable answer cache {path}: {exc}", file=sys.stderr)
        return {"series_by_character": {}, "skipped_series_by_character": []}

    if not isinstance(payload.get("series_by_character"), dict):
        payload["series_by_character"] = {}
    if not isinstance(payload.get("skipped_series_by_character"), list):
        payload["skipped_series_by_character"] = []
    return payload


def save_answers(path: Path, answers: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(answers, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
