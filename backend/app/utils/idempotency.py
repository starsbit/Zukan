from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi.encoders import jsonable_encoder

from backend.app.errors.error import AppError

idempotency_key_conflict = "idempotency_key_conflict"


@dataclass
class _IdempotencyEntry:
    body_hash: str | None
    status_code: int
    payload: Any
    created_at: datetime


class IdempotencyStore:
    def __init__(self, ttl_seconds: int = 24 * 60 * 60) -> None:
        self._ttl = timedelta(seconds=ttl_seconds)
        self._entries: dict[str, _IdempotencyEntry] = {}
        self._lock = asyncio.Lock()

    def _cleanup_expired(self) -> None:
        now = datetime.now(timezone.utc)
        expired = [
            key
            for key, entry in self._entries.items()
            if now - entry.created_at >= self._ttl
        ]
        for key in expired:
            self._entries.pop(key, None)

    async def get_replay(
        self,
        *,
        scope: str,
        idempotency_key: str | None,
        body_hash: str | None,
    ) -> tuple[int, Any] | None:
        if not idempotency_key:
            return None

        key = f"{scope}:{idempotency_key}"
        async with self._lock:
            self._cleanup_expired()
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.body_hash != body_hash:
                raise AppError(
                    status_code=409,
                    code=idempotency_key_conflict,
                    detail="Idempotency-Key was already used with a different payload",
                )
            return entry.status_code, entry.payload

    async def remember(
        self,
        *,
        scope: str,
        idempotency_key: str | None,
        body_hash: str | None,
        status_code: int,
        payload: Any,
    ) -> None:
        if not idempotency_key:
            return

        key = f"{scope}:{idempotency_key}"
        async with self._lock:
            self._cleanup_expired()
            self._entries[key] = _IdempotencyEntry(
                body_hash=body_hash,
                status_code=status_code,
                payload=payload,
                created_at=datetime.now(timezone.utc),
            )


idempotency_store = IdempotencyStore()


def idempotency_scope(*, user_id: Any, method: str, path: str) -> str:
    return f"{user_id}:{method.upper()}:{path}"


def idempotency_body_hash(payload: Any) -> str:
    normalized = jsonable_encoder(payload)
    encoded = json.dumps(normalized, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
