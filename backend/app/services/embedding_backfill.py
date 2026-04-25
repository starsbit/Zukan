from __future__ import annotations

import asyncio
import uuid

_embedding_backfill_queue: asyncio.Queue[uuid.UUID] | None = None


def set_embedding_backfill_queue(queue: asyncio.Queue[uuid.UUID]) -> None:
    global _embedding_backfill_queue
    _embedding_backfill_queue = queue


def get_embedding_backfill_queue() -> asyncio.Queue[uuid.UUID] | None:
    return _embedding_backfill_queue
