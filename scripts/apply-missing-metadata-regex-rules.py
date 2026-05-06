#!/usr/bin/env python3
"""Apply regex rules to downloaded missing metadata review items."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


MAX_MEDIA_IDS_PER_REQUEST = 500
DEFAULT_INPUT = ".metadata-review/missing-metadata-items.json"
DEFAULT_RULES = ".metadata-review/missing-metadata-regex-rules.json"
DEFAULT_OUTPUT = ".metadata-review/missing-metadata-entity-updates.json"
DEFAULT_MATCH_FIELDS = (
    "source_filename",
    "media.filename",
    "media.original_filename",
    "media.filepath",
    "media.ocr_text",
    "media.tags",
    "entities.name",
    "suggested_characters.name",
    "suggested_series.name",
)
STARTER_RULES = {
    "rules": [],
    "examples": [
        {
            "name": "filename contains fate saber",
            "pattern": "(?i)fate.*saber|saber.*fate",
            "fields": ["source_filename", "media.original_filename"],
            "character_names": ["Saber"],
            "series_names": ["Fate/stay night"],
        },
        {
            "name": "capture name from filename",
            "pattern": "(?i)(?P<series>grisaia).*makina",
            "fields": ["source_filename", "media.original_filename"],
            "character_names": ["Irisu Makina"],
            "series_names": ["\\g<series>"],
        },
    ],
}


@dataclass(frozen=True)
class Rule:
    name: str
    pattern: str
    regex: re.Pattern[str]
    character_names: tuple[str, ...]
    series_names: tuple[str, ...]
    fields: tuple[str, ...]
    only_missing: bool
    stop_on_match: bool


@dataclass(frozen=True)
class RuleMatch:
    rule_name: str
    field: str
    value: str


@dataclass(frozen=True)
class Assignment:
    media_id: str
    character_names: tuple[str, ...]
    series_names: tuple[str, ...]
    reason: str
    prompt_key: str
    matches: tuple[RuleMatch, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read missing-metadata-items.json, apply regex rules to filenames "
            "or other review item fields, and write postable PATCH /media/entities requests."
        ),
        epilog=(
            "Rules JSON example:\n"
            "{\n"
            '  "rules": [\n'
            "    {\n"
            '      "name": "fate files",\n'
            '      "pattern": "(?i)fate|saber|tohsaka",\n'
            '      "series_names": ["Fate/stay night"],\n'
            '      "character_names": ["Saber"],\n'
            '      "fields": ["source_filename", "media.original_filename"]\n'
            "    }\n"
            "  ]\n"
            "}\n"
            "Name values may use regex expansion such as \"\\\\g<series>\"."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input",
        default=DEFAULT_INPUT,
        help=f"Downloaded missing metadata JSON. Default: {DEFAULT_INPUT}",
    )
    parser.add_argument(
        "--rules",
        default=DEFAULT_RULES,
        help=f"Regex rules JSON. Default: {DEFAULT_RULES}",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Output JSON for post-missing-metadata-entity-updates.py. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--case-sensitive",
        action="store_true",
        help="Compile rules without re.IGNORECASE unless the rule pattern uses inline flags.",
    )
    parser.add_argument(
        "--first-match",
        action="store_true",
        help="Stop evaluating later rules for an item after the first matching rule.",
    )
    parser.add_argument(
        "--allow-existing",
        action="store_true",
        help="Allow rules to set entity types even when the review item is not missing that type.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print a summary without writing the output file.",
    )
    parser.add_argument(
        "--init-rules",
        action="store_true",
        help="Create a starter rules JSON at --rules and exit.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    rules_path = Path(args.rules)
    output_path = Path(args.output)

    if args.init_rules:
        return init_rules_file(rules_path)

    try:
        source_payload = load_json_object(input_path)
        rules_payload = load_json_object(rules_path)
        rules = parse_rules(rules_payload, case_sensitive=args.case_sensitive)
    except (OSError, json.JSONDecodeError, ValueError, re.error) as exc:
        print(f"Could not prepare regex metadata run: {format_prepare_error(exc)}", file=sys.stderr)
        return 1

    try:
        items = [item for item in source_payload.get("items", []) if isinstance(item, dict)]
        assignments = apply_rules(
            items=items,
            rules=rules,
            first_match=args.first_match,
            allow_existing=args.allow_existing,
        )
        requests = build_entity_requests(assignments)
        output_payload = build_output_payload(
            source_payload=source_payload,
            input_path=input_path,
            rules_path=rules_path,
            assignments=assignments,
            requests=requests,
            items=items,
        )
    except ValueError as exc:
        print(f"Could not apply regex metadata rules: {exc}", file=sys.stderr)
        return 1

    print(
        f"Matched {len(assignments)} of {len(items)} review item(s); "
        f"built {len(requests)} postable request(s)."
    )
    if args.dry_run:
        unresolved_count = output_payload["summary"]["unresolved_item_count"]
        print(f"Dry run: would leave {unresolved_count} review item(s) unresolved.")
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote regex metadata updates to {output_path}")
    return 0


def parse_rules(payload: dict[str, Any], *, case_sensitive: bool) -> list[Rule]:
    raw_rules = payload.get("rules")
    if not isinstance(raw_rules, list):
        raise ValueError("rules JSON must contain a top-level 'rules' list")

    rules: list[Rule] = []
    for index, raw_rule in enumerate(raw_rules, start=1):
        if not isinstance(raw_rule, dict):
            raise ValueError(f"rule {index} must be an object")

        name = clean_string(raw_rule.get("name")) or f"rule_{index}"
        pattern = clean_raw_string(raw_rule.get("pattern"))
        if not pattern:
            raise ValueError(f"rule {index} must include a non-empty pattern")

        character_names = parse_name_templates(raw_rule.get("character_names"), f"rule {index} character_names")
        series_names = parse_name_templates(raw_rule.get("series_names"), f"rule {index} series_names")
        if not character_names and not series_names:
            raise ValueError(f"rule {index} must include character_names or series_names")

        fields = parse_fields(raw_rule.get("fields"))
        rule_case_sensitive = bool(raw_rule.get("case_sensitive", case_sensitive))
        flags = 0 if rule_case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(pattern, flags)
        except re.error as exc:
            raise re.error(f"rule {index} pattern is invalid: {exc}") from exc

        rules.append(
            Rule(
                name=name,
                pattern=pattern,
                regex=regex,
                character_names=tuple(character_names),
                series_names=tuple(series_names),
                fields=tuple(fields),
                only_missing=bool(raw_rule.get("only_missing", True)),
                stop_on_match=bool(raw_rule.get("stop_on_match", False)),
            )
        )

    return rules


def parse_name_templates(value: Any, label: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = value
    else:
        raise ValueError(f"{label} must be a string or list of strings")

    names: list[str] = []
    for item in values:
        name = clean_string(item)
        if not name:
            continue
        names.append(name)
    return names


def parse_fields(value: Any) -> list[str]:
    if value is None:
        return list(DEFAULT_MATCH_FIELDS)
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = value
    else:
        raise ValueError("rule fields must be a string or list of strings")

    fields = [field.strip() for field in values if isinstance(field, str) and field.strip()]
    return fields or list(DEFAULT_MATCH_FIELDS)


def apply_rules(
    *,
    items: list[dict[str, Any]],
    rules: list[Rule],
    first_match: bool,
    allow_existing: bool,
) -> list[Assignment]:
    assignments: list[Assignment] = []

    for item in items:
        media_id = get_media_id(item)
        if media_id is None:
            continue

        character_names: list[str] = []
        series_names: list[str] = []
        matches: list[RuleMatch] = []

        for rule in rules:
            matched_rule = False
            for field, value in iter_match_values(item, rule.fields):
                match = rule.regex.search(value)
                if match is None:
                    continue

                matched_rule = True
                matches.append(RuleMatch(rule_name=rule.name, field=field, value=value))
                if should_apply_entity_type(item, "character", rule, allow_existing):
                    add_names(character_names, expand_names(rule.character_names, match))
                if should_apply_entity_type(item, "series", rule, allow_existing):
                    add_names(series_names, expand_names(rule.series_names, match))
                break

            if matched_rule and (first_match or rule.stop_on_match):
                break

        if character_names or series_names:
            assignments.append(
                Assignment(
                    media_id=media_id,
                    character_names=tuple(character_names),
                    series_names=tuple(series_names),
                    reason="regex_rule",
                    prompt_key=", ".join(unique(match.rule_name for match in matches)),
                    matches=tuple(matches),
                )
            )

    return assignments


def should_apply_entity_type(
    item: dict[str, Any],
    entity_type: str,
    rule: Rule,
    allow_existing: bool,
) -> bool:
    if entity_type == "character" and not rule.character_names:
        return False
    if entity_type == "series" and not rule.series_names:
        return False
    if allow_existing or not rule.only_missing:
        return True
    missing_key = f"missing_{entity_type}"
    return item.get(missing_key) is True


def iter_match_values(item: dict[str, Any], fields: Iterable[str]) -> Iterable[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    for field in fields:
        for value in values_at_path(item, field.split(".")):
            clean_value = clean_raw_string(value)
            if clean_value is None:
                continue
            key = (field, clean_value)
            if key in seen:
                continue
            seen.add(key)
            yield field, clean_value


def values_at_path(value: Any, path: list[str]) -> Iterable[Any]:
    if not path:
        yield value
        return
    if isinstance(value, list):
        for item in value:
            yield from values_at_path(item, path)
        return
    if not isinstance(value, dict):
        return
    key = path[0]
    if key not in value:
        return
    yield from values_at_path(value[key], path[1:])


def expand_names(templates: tuple[str, ...], match: re.Match[str]) -> list[str]:
    names: list[str] = []
    for template in templates:
        try:
            expanded = match.expand(template)
        except re.error as exc:
            raise ValueError(f"name template {template!r} could not be expanded: {exc}") from exc
        clean_name = clean_string(expanded)
        normalized_name = normalize_entity_name(clean_name) if clean_name else ""
        if normalized_name:
            names.append(normalized_name)
    return names


def build_output_payload(
    *,
    source_payload: dict[str, Any],
    input_path: Path,
    rules_path: Path,
    assignments: list[Assignment],
    requests: list[dict[str, Any]],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    assigned_media_ids = {assignment.media_id for assignment in assignments}
    unresolved = [
        compact_review_item(item)
        for item in items
        if get_media_id(item) not in assigned_media_ids
    ]
    assigned_character_count = sum(1 for assignment in assignments if assignment.character_names)
    assigned_series_count = sum(1 for assignment in assignments if assignment.series_names)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": str(input_path),
        "rules": str(rules_path),
        "source_fetched_at": source_payload.get("fetched_at"),
        "base_url": source_payload.get("base_url"),
        "endpoint": "/media/entities",
        "summary": {
            "source_item_count": len(items),
            "assigned_media_count": len(assignments),
            "assigned_character_media_count": assigned_character_count,
            "assigned_series_media_count": assigned_series_count,
            "request_count": len(requests),
            "unresolved_item_count": len(unresolved),
        },
        "requests": requests,
        "assignments": [
            {
                "media_id": assignment.media_id,
                "character_names": list(assignment.character_names),
                "series_names": list(assignment.series_names),
                "reason": assignment.reason,
                "prompt_key": assignment.prompt_key,
                "matches": [
                    {
                        "rule": match.rule_name,
                        "field": match.field,
                        "value": match.value,
                    }
                    for match in assignment.matches
                ],
            }
            for assignment in assignments
        ],
        "unresolved": unresolved,
    }


def build_entity_requests(assignments: list[Assignment]) -> list[dict[str, Any]]:
    grouped_media_ids: dict[tuple[tuple[str, ...], tuple[str, ...]], list[str]] = defaultdict(list)
    for assignment in assignments:
        grouped_media_ids[(assignment.character_names, assignment.series_names)].append(assignment.media_id)

    requests: list[dict[str, Any]] = []
    sorted_groups = sorted(
        grouped_media_ids.items(),
        key=lambda item: normalized_key(",".join([*item[0][0], *item[0][1]])),
    )
    for (character_names, series_names), media_ids in sorted_groups:
        unique_media_ids = sorted(set(media_ids))
        for chunk in chunks(unique_media_ids, MAX_MEDIA_IDS_PER_REQUEST):
            body: dict[str, Any] = {"media_ids": chunk}
            if character_names:
                body["character_names"] = list(character_names)
            if series_names:
                body["series_names"] = list(series_names)
            requests.append(
                {
                    "method": "PATCH",
                    "path": "/media/entities",
                    "body": body,
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
        "characters": entity_names(item, "character"),
        "series": entity_names(item, "series"),
    }


def entity_names(item: dict[str, Any], entity_type: str) -> list[str]:
    names: list[str] = []
    entities = item.get("entities")
    if not isinstance(entities, list):
        return names
    for entity in entities:
        if not isinstance(entity, dict) or entity.get("entity_type") != entity_type:
            continue
        name = clean_string(entity.get("name"))
        if name:
            names.append(name)
    return unique(names)


def get_media_id(item: dict[str, Any]) -> str | None:
    media = item.get("media")
    if not isinstance(media, dict):
        return None
    media_id = media.get("id")
    return media_id if isinstance(media_id, str) and media_id else None


def add_names(target: list[str], names: Iterable[str]) -> None:
    seen = {normalized_key(name) for name in target}
    for name in names:
        key = normalized_key(name)
        if not key or key in seen:
            continue
        seen.add(key)
        target.append(name)


def unique(values: Iterable[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = normalized_key(value)
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(value)
    return output


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.strip().split())
    return cleaned or None


def clean_raw_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def normalized_key(value: str) -> str:
    return " ".join(value.strip().casefold().replace("_", " ").split())


def normalize_entity_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value.strip())
    if not normalized:
        return ""

    normalized = normalized.replace("&", " and ")
    normalized = re.sub(r"""['".,!?]+""", "_", normalized)
    normalized = re.sub(r"[^a-zA-Z0-9()]+", "_", normalized)
    normalized = re.sub(r"_+", "_", normalized)
    normalized = re.sub(r"^_+|_+$", "", normalized)
    return normalized.lower()


def chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} top-level JSON value must be an object")
    return payload


def init_rules_file(path: Path) -> int:
    if path.exists():
        print(f"Rules file already exists: {path}")
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(STARTER_RULES, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote starter rules file to {path}")
    print("Edit the top-level 'rules' list, then run without --init-rules.")
    return 0


def format_prepare_error(exc: BaseException) -> str:
    if isinstance(exc, FileNotFoundError):
        missing_path = Path(exc.filename) if exc.filename else None
        if missing_path is not None:
            dotted_path = Path(f".{missing_path}")
            if not str(missing_path).startswith(".") and dotted_path.exists():
                return f"{exc}. Did you mean '{dotted_path}'?"
            if missing_path.name == Path(DEFAULT_RULES).name:
                return f"{exc}. Create one with --init-rules or pass --rules PATH."
    return str(exc)


if __name__ == "__main__":
    raise SystemExit(main())
