from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime

from sqlalchemy import and_

from backend.app.models.media import Media
from backend.app.repositories import media_filters


def captured_timestamp_expr():
    return media_filters.captured_timestamp_expr()


def encode_cursor(sort_val, item_id: uuid.UUID) -> str:
    s = sort_val.isoformat() if isinstance(sort_val, datetime) else sort_val
    payload = json.dumps({"s": s, "id": str(item_id)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_cursor(cursor: str, sort_by: str) -> tuple | None:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded))
        item_id = uuid.UUID(data["id"])
        s = data["s"]
        if sort_by in ("captured_at", "created_at"):
            sort_val = datetime.fromisoformat(s)
        elif sort_by == "file_size":
            sort_val = int(s)
        else:
            sort_val = s
        return sort_val, item_id
    except Exception:
        return None


def apply_cursor_where(stmt, sort_by: str, sort_order: str, cursor_val, cursor_id: uuid.UUID):
    sort_expr = {
        "captured_at": captured_timestamp_expr(),
        "created_at": Media.created_at,
        "filename": Media.filename,
        "file_size": Media.file_size,
    }[sort_by]
    if sort_order == "desc":
        return stmt.where(and_(sort_expr < cursor_val) | and_(sort_expr == cursor_val, Media.id < cursor_id))
    return stmt.where(and_(sort_expr > cursor_val) | and_(sort_expr == cursor_val, Media.id > cursor_id))
