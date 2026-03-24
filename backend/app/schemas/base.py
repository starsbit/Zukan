from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ErrorField(BaseModel):
    field: str
    message: str
    type: str | None = None


class ErrorResponse(BaseModel):
    code: str
    message: str
    detail: str
    status: int
    request_id: str
    trace_id: str
    details: Any | None = None
    fields: list[ErrorField] | None = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "code": "version_conflict",
                "message": "Resource version mismatch",
                "detail": "Resource version mismatch",
                "status": 409,
                "request_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
                "trace_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
                "details": {
                    "current_version": 6,
                    "provided_version": 5,
                },
                "fields": None,
            }
        }
    }


ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Bad request"},
    401: {"model": ErrorResponse, "description": "Not authenticated"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict"},
    422: {"model": ErrorResponse, "description": "Validation error"},
    429: {"model": ErrorResponse, "description": "Rate limit exceeded"},
}