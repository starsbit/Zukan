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


def encode_cursor(sort_val, item_id) -> str:
    s = sort_val.isoformat() if isinstance(sort_val, datetime) else sort_val
    payload = json.dumps({"s": s, "id": str(item_id)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_cursor_typed(cursor: str, value_type: str, id_type: str = "uuid") -> tuple | None:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded))
        if id_type == "int":
            item_id = int(data["id"])
        elif id_type == "str":
            item_id = str(data["id"])
        else:
            item_id = uuid.UUID(data["id"])
        s = data["s"]
        if value_type == "datetime":
            sort_val = datetime.fromisoformat(s)
        elif value_type == "int":
            sort_val = int(s)
        else:
            sort_val = s
        return sort_val, item_id
    except Exception:
        return None


def decode_cursor(cursor: str, sort_by: str) -> tuple | None:
    value_type = "str"
    if sort_by in ("captured_at", "uploaded_at"):
        value_type = "datetime"
    elif sort_by == "file_size":
        value_type = "int"
    return decode_cursor_typed(cursor, value_type)


def apply_cursor_where_expr(stmt, *, sort_expr, id_expr, sort_order: str, cursor_val, cursor_id: uuid.UUID):
    if sort_order == "desc":
        return stmt.where(and_(sort_expr < cursor_val) | and_(sort_expr == cursor_val, id_expr < cursor_id))
    return stmt.where(and_(sort_expr > cursor_val) | and_(sort_expr == cursor_val, id_expr > cursor_id))


def apply_cursor_where(stmt, sort_by: str, sort_order: str, cursor_val, cursor_id: uuid.UUID):
    sort_expr = {
        "captured_at": captured_timestamp_expr(),
        "uploaded_at": Media.uploaded_at,
        "filename": Media.filename,
        "file_size": Media.file_size,
    }[sort_by]
    return apply_cursor_where_expr(
        stmt,
        sort_expr=sort_expr,
        id_expr=Media.id,
        sort_order=sort_order,
        cursor_val=cursor_val,
        cursor_id=cursor_id,
    )
