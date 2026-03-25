from __future__ import annotations

import asyncio

_tag_queue: asyncio.Queue | None = None


def set_tag_queue(queue: asyncio.Queue) -> None:
    global _tag_queue
    _tag_queue = queue


def get_tag_queue() -> asyncio.Queue | None:
    return _tag_queue


__all__ = ["get_tag_queue", "set_tag_queue"]
