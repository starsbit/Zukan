import re
import uuid
from fastapi import Request
from fastapi.responses import JSONResponse
from backend.app.errors.error import build_error_response

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
ALLOWED_WRITE_PATHS = {
    "/api/v1/auth/demo",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
}
BLOCKED_READ_PATHS = (
    re.compile(r"^/api/v1/admin(/|$)"),
    re.compile(r"^/api/v1/albums/[^/]+/download$"),
    re.compile(r"^/api/v1/media/[^/]+/library-classification-suggestions$"),
    re.compile(r"^/api/v1/auth/oidc/"),
)


def is_blocked_in_demo(method: str, path: str, query: dict[str, str] | None = None) -> bool:
    path = path.rstrip("/") or "/"
    if method.upper() in SAFE_METHODS:
        if (query or {}).get("force_refresh", "").lower() in {"1", "true"}:
            return True
        return any(pattern.match(path) for pattern in BLOCKED_READ_PATHS)
    return path not in ALLOWED_WRITE_PATHS


async def demo_read_only_middleware(request: Request, call_next):
    if not is_blocked_in_demo(request.method, request.url.path, dict(request.query_params)):
        return await call_next(request)
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    payload = build_error_response(
        status_code=403,
        code="demo_read_only",
        message="This is a read-only demo. Changes are disabled.",
        request_id=request_id,
        trace_id=request_id,
    )
    return JSONResponse(status_code=403, content=payload, headers={"x-request-id": request_id})
