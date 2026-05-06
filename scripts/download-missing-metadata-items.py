#!/usr/bin/env python3
"""Download Zukan media items that are missing character or series metadata."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ZUKAN_API_BASE_URL = "http://zukan.home.arpa/api/v1"
DEFAULT_USERNAME = "stars"
DEFAULT_OUTPUT = ".metadata-review/missing-metadata-items.json"


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
            "Download all review items missing character or "
            "series metadata."
        )
    )
    parser.add_argument(
        "--base-url",
        default=ZUKAN_API_BASE_URL,
        help="API base URL, for example http://zukan.home.arpa/api/v1.",
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
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"JSON file to write. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=600.0,
        help="HTTP timeout in seconds. Default: 600",
    )
    parser.add_argument(
        "--include-recommendations",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Ask the API to include library recommendations when available. Default: true",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    password = args.password or getpass.getpass(f"Password for {args.username}: ")

    base_url = normalize_base_url(args.base_url)
    endpoints = {
        "login": join_url(base_url, "/auth/login"),
        "review_items": join_url(base_url, "/me/import-batches/review-items"),
        "review_summary": join_url(base_url, "/me/import-batches/review-summary"),
        "batch_review_items": join_url(base_url, "/me/import-batches/{batch_id}/review-items"),
    }

    try:
        review_payload = fetch_review_payload(
            endpoints=endpoints,
            username=args.username,
            password=password,
            include_recommendations=args.include_recommendations,
            timeout=args.timeout,
        )
    except ApiError as exc:
        print(f"API request failed: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Could not reach API: {exc}", file=sys.stderr)
        return 1

    items = review_payload.get("items", [])
    output_payload = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "base_url": base_url,
        "username": args.username,
        "endpoints": endpoints,
        "review_total": review_payload.get("total", len(items)),
        "item_count": len(items),
        "include_recommendations": args.include_recommendations,
        "recommendation_groups": review_payload.get("recommendation_groups", []),
        "items": items,
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"Wrote {len(items)} missing metadata item(s) to {output_path}")
    return 0


def normalize_base_url(base_url: str) -> str:
    if base_url:
        return base_url.rstrip("/")
    raise ValueError("API base URL is required. Provide --base-url or set ZUKAN_API_BASE_URL.")


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
    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise ApiError("login response did not include an access_token")
    return token


def build_auth_headers(login_url: str, username: str, password: str, timeout: float) -> dict[str, str]:
    token = login(login_url, username, password, timeout)
    return {"Authorization": f"Bearer {token}"}


def fetch_review_payload(
    *,
    endpoints: dict[str, str],
    username: str,
    password: str,
    include_recommendations: bool,
    timeout: float,
) -> Any:
    params = {"include_recommendations": str(include_recommendations).lower()}
    try:
        auth_headers = build_auth_headers(endpoints["login"], username, password, timeout)
        return request_json(
            "GET",
            endpoints["review_items"],
            headers=auth_headers,
            params=params,
            timeout=timeout,
        )
    except ApiHttpError as exc:
        if include_recommendations and exc.status_code == 504:
            print(
                "Primary review-items request timed out at gateway (HTTP 504). "
                "Falling back to per-batch requests.",
                file=sys.stderr,
            )
            return fetch_review_payload_per_batch(
                endpoints=endpoints,
                username=username,
                password=password,
                include_recommendations=include_recommendations,
                timeout=timeout,
            )
        raise


def fetch_review_payload_per_batch(
    *,
    endpoints: dict[str, str],
    username: str,
    password: str,
    include_recommendations: bool,
    timeout: float,
) -> dict[str, Any]:
    summary_headers = build_auth_headers(endpoints["login"], username, password, timeout)
    summary_payload = request_json(
        "GET",
        endpoints["review_summary"],
        headers=summary_headers,
        timeout=timeout,
    )
    batch_ids = [str(batch_id) for batch_id in summary_payload.get("review_batch_ids", [])]
    params = {"include_recommendations": str(include_recommendations).lower()}

    combined_items: list[Any] = []
    combined_groups: list[Any] = []
    total = 0

    for index, batch_id in enumerate(batch_ids, start=1):
        print(f"Fetching review items for batch {index}/{len(batch_ids)}: {batch_id}", file=sys.stderr)
        batch_headers = build_auth_headers(endpoints["login"], username, password, timeout)
        batch_payload = request_json(
            "GET",
            endpoints["batch_review_items"].format(batch_id=batch_id),
            headers=batch_headers,
            params=params,
            timeout=timeout,
        )
        batch_items = batch_payload.get("items", [])
        batch_groups = batch_payload.get("recommendation_groups", [])

        combined_items.extend(batch_items)
        combined_groups.extend(prefix_group_ids(batch_groups, batch_id))
        total += int(batch_payload.get("total", len(batch_items)))

    return {
        "total": total,
        "items": combined_items,
        "recommendation_groups": combined_groups,
    }


def prefix_group_ids(groups: list[Any], batch_id: str) -> list[Any]:
    prefixed: list[Any] = []
    for group in groups:
        if isinstance(group, dict):
            copied = dict(group)
            group_id = copied.get("id")
            if isinstance(group_id, str) and group_id:
                copied["id"] = f"{batch_id}:{group_id}"
            prefixed.append(copied)
        else:
            prefixed.append(group)
    return prefixed


def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
    form: dict[str, str] | None = None,
    timeout: float,
) -> Any:
    request_url = add_query_params(url, params)
    body: bytes | None = None
    request_headers = {"Accept": "application/json", **(headers or {})}

    if form is not None:
        body = urllib.parse.urlencode(form).encode("utf-8")
        request_headers["Content-Type"] = "application/x-www-form-urlencoded"

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


if __name__ == "__main__":
    raise SystemExit(main())
