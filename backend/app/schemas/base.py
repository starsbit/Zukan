from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorField(BaseModel):
    field: str = Field(description="Request field path associated with the validation issue.")
    message: str = Field(description="Human-readable validation message for the field.")
    type: str | None = Field(default=None, description="Optional machine-oriented validation error type.")


class ErrorResponse(BaseModel):
    code: str = Field(description="Stable machine-readable error code.")
    message: str = Field(
        description="Stable human-readable summary intended for display or logging."
    )
    detail: str = Field(
        description="Instance-specific detail text. Currently equal to `message` in this API version."
    )
    status: int = Field(description="HTTP status code for this error response.")
    request_id: str = Field(description="Request correlation id returned in response headers.")
    trace_id: str = Field(
        description="Trace correlation id for distributed tracing. Currently equal to `request_id` in this deployment."
    )
    details: Any | None = Field(default=None, description="Optional structured metadata for this error type.")
    fields: list[ErrorField] | None = Field(
        default=None,
        description="Optional per-field validation errors, typically present on 422 responses.",
    )


ERROR_RESPONSE_EXAMPLES = {
    400: {
        "code": "upload_limit_exceeded",
        "message": "Max 20 files per request",
        "detail": "Max 20 files per request",
        "status": 400,
        "request_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "trace_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "details": None,
        "fields": None,
    },
    401: {
        "code": "not_authenticated",
        "message": "Not authenticated",
        "detail": "Not authenticated",
        "status": 401,
        "request_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "trace_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "details": None,
        "fields": None,
    },
    403: {
        "code": "forbidden",
        "message": "Forbidden",
        "detail": "Forbidden",
        "status": 403,
        "request_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "trace_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "details": None,
        "fields": None,
    },
    404: {
        "code": "media_not_found",
        "message": "Not found",
        "detail": "Not found",
        "status": 404,
        "request_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "trace_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "details": None,
        "fields": None,
    },
    409: {
        "code": "idempotency_key_conflict",
        "message": "Idempotency-Key was already used with a different payload",
        "detail": "Idempotency-Key was already used with a different payload",
        "status": 409,
        "request_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "trace_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "details": None,
        "fields": None,
    },
    422: {
        "code": "validation_error",
        "message": "Request validation failed",
        "detail": "Request validation failed",
        "status": 422,
        "request_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "trace_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "details": {"error_count": 1},
        "fields": [{"field": "password", "message": "String should have at least 8 characters", "type": "string_too_short"}],
    },
    429: {
        "code": "rate_limit_exceeded",
        "message": "Rate limit exceeded",
        "detail": "Rate limit exceeded",
        "status": 429,
        "request_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "trace_id": "d4f8e113-2d0d-4f86-a183-c2bc90f341fa",
        "details": {"retry_after_seconds": 27},
        "fields": None,
    },
}


def _response_with_example(status_code: int, description: str) -> dict[str, Any]:
    return {
        "model": ErrorResponse,
        "description": description,
        "content": {
            "application/json": {
                "example": ERROR_RESPONSE_EXAMPLES[status_code],
            }
        },
    }


ERROR_RESPONSES = {
    400: _response_with_example(400, "Bad request"),
    401: _response_with_example(401, "Not authenticated"),
    403: _response_with_example(403, "Forbidden"),
    404: _response_with_example(404, "Not found"),
    409: _response_with_example(409, "Conflict"),
    422: _response_with_example(422, "Validation error"),
    429: _response_with_example(429, "Rate limit exceeded"),
}


def error_responses(*status_codes: int) -> dict[int, dict[str, Any]]:
    return {status_code: ERROR_RESPONSES[status_code] for status_code in status_codes}


AUTHENTICATED_ERROR_RESPONSES = error_responses(401)
ADMIN_ERROR_RESPONSES = error_responses(401, 403)