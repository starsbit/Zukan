#!/usr/bin/env python3
"""Filter missing metadata review items down to entries with no series assigned."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_INPUT = ".metadata-review/missing-metadata-items.json"
DEFAULT_OUTPUT = ".metadata-review/missing-metadata-no-series.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read missing-metadata-items.json and keep only items without a series assignment."
        )
    )
    parser.add_argument(
        "--input",
        default=DEFAULT_INPUT,
        help=f"Source JSON. Default: {DEFAULT_INPUT}",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Filtered JSON output. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--strict-missing-flag",
        action="store_true",
        help=(
            "Only keep items where missing_series is true. By default, items without a series entity are kept."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    try:
        payload = load_json_object(input_path)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Could not read {input_path}: {exc}", file=sys.stderr)
        return 1

    items = [item for item in payload.get("items", []) if isinstance(item, dict)]
    filtered_items = [
        item
        for item in items
        if item_has_no_series(item, strict_missing_flag=args.strict_missing_flag)
    ]

    output_payload = dict(payload)
    output_payload["items"] = filtered_items
    output_payload["item_count"] = len(filtered_items)
    output_payload["filtered_at"] = datetime.now(timezone.utc).isoformat()
    output_payload["filter"] = {
        "strict_missing_series": args.strict_missing_flag,
        "source_item_count": len(items),
        "filtered_item_count": len(filtered_items),
        "definition": (
            "missing_series is true" if args.strict_missing_flag else "missing_series is true OR no series entity"
        ),
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"Wrote {len(filtered_items)} item(s) without series to {output_path}")
    return 0


def item_has_no_series(item: dict[str, Any], *, strict_missing_flag: bool) -> bool:
    missing_series = item.get("missing_series") is True
    if strict_missing_flag:
        return missing_series
    return missing_series or not item_has_series_entity(item)


def item_has_series_entity(item: dict[str, Any]) -> bool:
    entities = item.get("entities")
    if not isinstance(entities, list):
        return False
    return any(
        isinstance(entity, dict) and entity.get("entity_type") == "series"
        for entity in entities
    )


def load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Expected a top-level JSON object")
    return payload


if __name__ == "__main__":
    raise SystemExit(main())
