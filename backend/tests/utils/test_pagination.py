from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import column, select

from backend.app.utils.pagination import apply_cursor_where_expr, decode_cursor, decode_cursor_typed, encode_cursor


def test_encode_decode_cursor_datetime_and_int():
    now = datetime.now(timezone.utc)
    item_id = uuid.uuid4()
    cursor = encode_cursor(now, item_id)
    decoded = decode_cursor_typed(cursor, "datetime")
    assert decoded == (now, item_id)

    cursor2 = encode_cursor(10, item_id)
    decoded2 = decode_cursor_typed(cursor2, "int")
    assert decoded2 == (10, item_id)


def test_decode_cursor_invalid_returns_none():
    assert decode_cursor_typed("bad", "datetime") is None
    assert decode_cursor("bad", "file_size") is None


def test_apply_cursor_where_expr_builds_filterable_stmt():
    stmt = select(column("id"))
    sort_expr = column("created_at")
    id_expr = column("id")
    out = apply_cursor_where_expr(stmt, sort_expr=sort_expr, id_expr=id_expr, sort_order="desc", cursor_val=1, cursor_id=uuid.uuid4())
    assert out is not None
