from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Request

from backend.app.errors.error import AppError

rate_limit_exceeded = "rate_limit_exceeded"


@dataclass
class _Counter:
    window_started_at: datetime
    count: int


class RateLimitStore:
    def __init__(self) -> None:
        self._entries: dict[str, _Counter] = {}
        self._lock = asyncio.Lock()

    async def check(self, *, key: str, max_requests: int, window_seconds: int) -> None:
        now = datetime.now(timezone.utc)
        window = timedelta(seconds=window_seconds)

        async with self._lock:
            counter = self._entries.get(key)
            if counter is None or now - counter.window_started_at >= window:
                self._entries[key] = _Counter(window_started_at=now, count=1)
                return

            if counter.count >= max_requests:
                retry_after = max(1, int((counter.window_started_at + window - now).total_seconds()))
                raise AppError(
                    status_code=429,
                    code=rate_limit_exceeded,
                    detail="Rate limit exceeded",
                    details={"retry_after_seconds": retry_after},
                )

            counter.count += 1


rate_limit_store = RateLimitStore()


def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


def rate_limit(*, max_requests: int, window_seconds: int, scope: str):
    async def _dependency(request: Request) -> None:
        client_key = _client_ip(request)
        key = f"{scope}:{client_key}"
        await rate_limit_store.check(key=key, max_requests=max_requests, window_seconds=window_seconds)

    return _dependency
