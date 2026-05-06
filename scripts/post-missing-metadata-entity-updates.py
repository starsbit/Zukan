#!/usr/bin/env python3
"""Post generated missing metadata entity updates and accepted feedback."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ZUKAN_API_BASE_URL = "http://zukan.home.arpa/api/v1"
DEFAULT_USERNAME = "stars"
FEEDBACK_BATCH_SIZE = 100
DEFAULT_INPUT = ".metadata-review/missing-metadata-entity-updates.json"
ENTITY_NAME_FIELDS = {
    "character_names": "character",
    "series_names": "series",
}


class ApiError(RuntimeError):
    """Raised when the remote API returns an error response."""


class ApiHttpError(ApiError):
    """Raised when the remote API returns a non-success HTTP status."""

    def __init__(self, method: str, url: str, status_code: int, detail: str):
        self.method = method
        self.url = url
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"{method} {url} returned HTTP {status_code}: {detail}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read missing-metadata-entity-updates.json, post PATCH /media/entities "
            "requests, and record accepted library classification feedback."
        )
    )
    parser.add_argument(
        "--input",
        default=DEFAULT_INPUT,
        help=f"Generated entity update JSON. Default: {DEFAULT_INPUT}",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="API base URL. Defaults to base_url in the input file, then the production default.",
    )
    parser.add_argument(
        "--username",
        default=os.environ.get("ZUKAN_USERNAME", DEFAULT_USERNAME),
        help=f"Login username. Default: {DEFAULT_USERNAME}",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("ZUKAN_PASSWORD"),
        help="Login password. Prefer ZUKAN_PASSWORD for local automation.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=600.0,
        help="HTTP timeout in seconds. Default: 600",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be posted without contacting the API.",
    )
    parser.add_argument(
        "--skip-entity-updates",
        action="store_true",
        help="Only post accepted feedback; do not PATCH /media/entities.",
    )
    parser.add_argument(
        "--skip-feedback",
        action="store_true",
        help="Only PATCH /media/entities; do not record classification feedback.",
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Continue with later requests when one entity update or feedback batch fails.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    try:
        payload = load_json_object(input_path)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Could not read {input_path}: {exc}", file=sys.stderr)
        return 1

    requests = parse_entity_requests(payload)
    if not requests:
        print(f"No entity update requests found in {input_path}")
        return 0

    feedback_lookup = build_assignment_feedback_lookup(payload)
    request_count = len(requests)
    media_count = sum(len(request["body"].get("media_ids", [])) for request in requests)
    feedback_count = sum(len(build_feedback_items_for_request(request, feedback_lookup)) for request in requests)
    normalized_change_count = sum(len(request.get("normalized_entity_names", [])) for request in requests)

    if args.dry_run:
        print(
            f"Dry run: would post {request_count} entity request(s) covering "
            f"{media_count} media item reference(s)."
        )
        if normalized_change_count:
            print(f"Dry run: would normalize {normalized_change_count} entity name value(s).")
        if not args.skip_feedback:
            print(f"Dry run: would post {feedback_count} accepted feedback item(s).")
        return 0

    base_url = normalize_base_url(args.base_url or payload.get("base_url") or ZUKAN_API_BASE_URL)
    endpoints = {
        "login": join_url(base_url, "/auth/login"),
        "media_entities": join_url(base_url, "/media/entities"),
        "feedback_bulk": join_url(base_url, "/media/library-classification-feedback/bulk"),
    }
    password = args.password or getpass.getpass(f"Password for {args.username}: ")

    try:
        headers = build_auth_headers(endpoints["login"], args.username, password, args.timeout)
        summary = post_updates_and_feedback(
            args=args,
            requests=requests,
            feedback_lookup=feedback_lookup,
            endpoints=endpoints,
            headers=headers,
        )
    except ApiError as exc:
        print(f"API request failed: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Could not reach API: {exc}", file=sys.stderr)
        return 1

    print(
        "Done: "
        f"entity_processed={summary['entity_processed']} "
        f"entity_skipped={summary['entity_skipped']} "
        f"feedback_processed={summary['feedback_processed']} "
        f"feedback_skipped={summary['feedback_skipped']}"
    )
    return 0 if summary["errors"] == 0 else 1


def post_updates_and_feedback(
    *,
    args: argparse.Namespace,
    requests: list[dict[str, Any]],
    feedback_lookup: dict[tuple[str, str], dict[str, Any]],
    endpoints: dict[str, str],
    headers: dict[str, str],
) -> dict[str, int]:
    summary = {
        "entity_processed": 0,
        "entity_skipped": 0,
        "feedback_processed": 0,
        "feedback_skipped": 0,
        "errors": 0,
    }

    deferred_feedback_items: list[dict[str, Any]] = []

    for index, request in enumerate(requests, start=1):
        body = request["body"]
        feedback_items = build_feedback_items_for_request(request, feedback_lookup)

        if args.skip_entity_updates:
            print(f"Skipping entity update {index}/{len(requests)} by request.")
            deferred_feedback_items.extend(feedback_items)
            continue

        try:
            result = request_json(
                "PATCH",
                endpoints["media_entities"],
                headers=headers,
                json_body=body,
                timeout=args.timeout,
            )
        except (ApiError, OSError) as exc:
            summary["errors"] += 1
            print(f"Entity update {index}/{len(requests)} failed: {exc}", file=sys.stderr)
            if not args.continue_on_error:
                raise
            continue

        processed = int(result.get("processed", 0)) if isinstance(result, dict) else 0
        skipped = int(result.get("skipped", 0)) if isinstance(result, dict) else 0
        summary["entity_processed"] += processed
        summary["entity_skipped"] += skipped
        print(f"Entity update {index}/{len(requests)}: processed={processed} skipped={skipped}")
        deferred_feedback_items.extend(feedback_items)

    if args.skip_feedback:
        return summary

    for index, chunk in enumerate(chunks(deferred_feedback_items, FEEDBACK_BATCH_SIZE), start=1):
        try:
            result = request_json(
                "POST",
                endpoints["feedback_bulk"],
                headers=headers,
                json_body={"items": chunk},
                timeout=args.timeout,
            )
        except (ApiError, OSError) as exc:
            summary["errors"] += 1
            print(f"Feedback batch {index} failed: {exc}", file=sys.stderr)
            if not args.continue_on_error:
                raise
            continue

        processed = int(result.get("processed", 0)) if isinstance(result, dict) else 0
        skipped = int(result.get("skipped", 0)) if isinstance(result, dict) else 0
        summary["feedback_processed"] += processed
        summary["feedback_skipped"] += skipped
        print(f"Feedback batch {index}: processed={processed} skipped={skipped}")

    return summary


def parse_entity_requests(payload: dict[str, Any]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    raw_requests = payload.get("requests")
    if not isinstance(raw_requests, list):
        return parsed

    for index, request in enumerate(raw_requests, start=1):
        if not isinstance(request, dict):
            raise ValueError(f"request {index} must be an object")
        method = request.get("method", "PATCH")
        path = request.get("path", "/media/entities")
        body = request.get("body")
        if method != "PATCH" or path != "/media/entities":
            continue
        if not isinstance(body, dict):
            raise ValueError(f"request {index} body must be an object")
        media_ids = body.get("media_ids")
        if not valid_string_list(media_ids):
            raise ValueError(f"request {index} must include a media_ids list")

        normalized_body: dict[str, Any] = {"media_ids": media_ids}
        normalized_changes: list[dict[str, str]] = []
        entity_field_count = 0
        for field in ENTITY_NAME_FIELDS:
            names = body.get(field)
            if names is None:
                continue
            if not valid_string_list(names):
                raise ValueError(f"request {index} {field} must be a list of non-empty strings")
            normalized_names, changes = normalize_entity_names(names)
            if not normalized_names:
                raise ValueError(f"request {index} must include at least one non-empty normalized {field} value")
            normalized_body[field] = normalized_names
            normalized_changes.extend({"field": field, **change} for change in changes)
            entity_field_count += 1

        if entity_field_count == 0:
            raise ValueError(f"request {index} must include character_names or series_names")

        parsed.append({
            "method": method,
            "path": path,
            "body": normalized_body,
            "normalized_entity_names": normalized_changes,
        })
    return parsed


def build_assignment_feedback_lookup(payload: dict[str, Any]) -> dict[tuple[str, str, str], dict[str, Any]]:
    lookup: dict[tuple[str, str, str], dict[str, Any]] = {}
    assignments = payload.get("assignments")
    if not isinstance(assignments, list):
        return lookup

    for assignment in assignments:
        if not isinstance(assignment, dict):
            continue
        media_id = assignment.get("media_id")
        if not isinstance(media_id, str):
            continue
        prompt_key = assignment.get("prompt_key")
        reason = assignment.get("reason")
        source = "missing_metadata_regex" if reason == "regex_rule" else "missing_metadata_resolver"
        for field, entity_type in ENTITY_NAME_FIELDS.items():
            names = assignment.get(field)
            if not valid_string_list(names):
                continue
            for name in names:
                normalized_name = normalize_entity_name(name)
                if not normalized_name:
                    continue
                lookup[(media_id, entity_type, normalized_name)] = {
                    "source": source,
                    "explanation": build_feedback_explanation(reason, prompt_key),
                }
    return lookup


def build_feedback_items_for_request(
    request: dict[str, Any],
    feedback_lookup: dict[tuple[str, str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    body = request["body"]
    media_ids = body.get("media_ids", [])
    feedback_items: list[dict[str, Any]] = []

    for media_id in media_ids:
        for field, entity_type in ENTITY_NAME_FIELDS.items():
            for entity_name in body.get(field, []):
                extra = feedback_lookup.get(
                    (media_id, entity_type, entity_name),
                    {
                        "source": "missing_metadata_resolver",
                        "explanation": "Accepted from generated missing metadata entity update file.",
                    },
                )
                feedback_items.append(
                    {
                        "media_id": media_id,
                        "entity_type": entity_type,
                        "suggested_name": entity_name,
                        "action": "accepted",
                        "source": extra["source"],
                        "explanation": extra["explanation"],
                    }
                )
    return feedback_items


def build_feedback_explanation(reason: Any, prompt_key: Any) -> str:
    parts = ["Accepted while resolving missing metadata."]
    if isinstance(reason, str) and reason:
        parts.append(f"Reason: {reason}.")
    if isinstance(prompt_key, str) and prompt_key:
        parts.append(f"Prompt key: {prompt_key}.")
    return " ".join(parts)[:1024]


def valid_string_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) and item for item in value)


def normalize_entity_names(values: list[str]) -> tuple[list[str], list[dict[str, str]]]:
    normalized: list[str] = []
    changes: list[dict[str, str]] = []
    seen: set[str] = set()

    for value in values:
        name = normalize_entity_name(value)
        if not name or name in seen:
            continue
        seen.add(name)
        normalized.append(name)
        if name != value:
            changes.append({"from": value, "to": name})

    return normalized, changes


def normalize_entity_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value.strip())
    if not normalized:
        return ""

    normalized = (
        normalized
        .replace("&", " and ")
    )
    normalized = re.sub(r"""['".,!?]+""", "_", normalized)
    normalized = re.sub(r"[^a-zA-Z0-9()]+", "_", normalized)
    normalized = re.sub(r"_+", "_", normalized)
    normalized = re.sub(r"^_+|_+$", "", normalized)
    return normalized.lower()


def load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("top-level JSON value must be an object")
    return payload


def normalize_base_url(base_url: str) -> str:
    if base_url:
        return base_url.rstrip("/")
    raise ValueError("API base URL is required. Provide --base-url or keep base_url in the input JSON.")


def join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def login(login_url: str, username: str, password: str, timeout: float) -> str:
    payload = request_json(
        "POST",
        login_url,
        form={
            "username": username,
            "password": password,
            "remember_me": "false",
        },
        timeout=timeout,
    )
    token = payload.get("access_token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token:
        raise ApiError("login response did not include an access_token")
    return token


def build_auth_headers(login_url: str, username: str, password: str, timeout: float) -> dict[str, str]:
    token = login(login_url, username, password, timeout)
    return {"Authorization": f"Bearer {token}"}


def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
    form: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float,
) -> Any:
    request_url = add_query_params(url, params)
    body: bytes | None = None
    request_headers = {"Accept": "application/json", **(headers or {})}

    if form is not None and json_body is not None:
        raise ApiError("request cannot contain both form and JSON bodies")
    if form is not None:
        body = urllib.parse.urlencode(form).encode("utf-8")
        request_headers["Content-Type"] = "application/x-www-form-urlencoded"
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"

    request = urllib.request.Request(request_url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read()
    except urllib.error.HTTPError as exc:
        detail = read_error_detail(exc)
        raise ApiHttpError(method, request_url, exc.code, detail) from exc

    if not response_body:
        return None
    try:
        return json.loads(response_body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiError(f"{method} {request_url} returned invalid JSON") from exc


def add_query_params(url: str, params: dict[str, str] | None) -> str:
    if not params:
        return url

    parsed = urllib.parse.urlsplit(url)
    existing = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query = urllib.parse.urlencode([*existing, *params.items()])
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


def read_error_detail(exc: urllib.error.HTTPError) -> str:
    raw = exc.read().decode("utf-8", errors="replace")
    if not raw:
        return exc.reason
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return raw[:500]
    return json.dumps(payload, sort_keys=True)


def chunks(values: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


if __name__ == "__main__":
    raise SystemExit(main())
