from __future__ import annotations

from typing import Any

from fastapi import HTTPException


class AppError(HTTPException):
    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        *,
        details: Any | None = None,
        fields: list[dict[str, Any]] | None = None,
    ):
        payload: dict[str, Any] = {
            "code": code,
            "message": detail,
            "detail": detail,
            "status": status_code,
            "details": details,
            "fields": fields,
        }
        super().__init__(status_code=status_code, detail=payload)


def build_error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    trace_id: str,
    details: Any | None = None,
    fields: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "detail": message,
        "status": status_code,
        "request_id": request_id,
        "trace_id": trace_id,
        "details": details,
        "fields": fields,
    }