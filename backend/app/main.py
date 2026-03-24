import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html, get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select

from backend.app.errors.error import AppError, build_error_response

from backend.app.database import AsyncSessionLocal, init_db
from backend.app.config import settings
from backend.app.models.auth import User
from backend.app.models.media import Media
from backend.app.models import notifications as _notifications_models  # noqa: F401
from backend.app.models import processing as _processing_models  # noqa: F401
from backend.app.routers import admin, albums, auth, batches, config, media, notifications, tags, users
from backend.app.routers.deps import docs_user
from backend.app.services.media import set_tag_queue, MediaService
from backend.app.services.auth import AuthService
from backend.app.services.tags import TagService
from backend.app.ml.tagger import tagger

tag_queue: asyncio.Queue = asyncio.Queue()

API_VERSION = "0.1.0"
OPENAPI_TAGS = [
    {"name": "auth", "description": "Authentication and token lifecycle endpoints."},
    {"name": "users", "description": "Current-user profile read/update operations."},
    {"name": "media", "description": "Media upload, filtering, metadata mutation, and download operations."},
    {"name": "albums", "description": "Album management, sharing, and album-scoped media operations."},
    {"name": "tags", "description": "Tag browsing, filtering utilities, and tag management actions."},
    {"name": "admin", "description": "Administrative controls and diagnostics. Admin authentication required."},
    {"name": "batches", "description": "Import and processing batch visibility endpoints."},
    {"name": "notifications", "description": "Announcement and user notification endpoints."},
    {"name": "config", "description": "Client-facing runtime limits and feature configuration endpoints."},
]
OPENAPI_SERVERS = [
    {"url": "http://localhost:8000", "description": "Local development server"},
    {"url": "http://127.0.0.1:8000", "description": "Local loopback server"},
]
OPENAPI_EXTERNAL_DOCS = {
    "description": "Public API behavior contract",
    "url": "/redoc",
}


async def tagging_worker():
    while True:
        media_id: uuid.UUID = await tag_queue.get()
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(select(Media).where(Media.id == media_id))
                media_item = result.scalar_one_or_none()
                if media_item is None:
                    continue
                await TagService(db, tagger).tag_media(media_id)
                await MediaService(db).mark_upload_batch_item_done(media_id)

            except Exception as exc:
                await db.rollback()
                async with AsyncSessionLocal() as err_db:
                    media_service = MediaService(err_db)
                    await media_service.mark_tagging_failure(media_id, exc)
                    await media_service.mark_upload_batch_item_failed(media_id, str(exc))
                print(f"Tagging failed for {media_id}: {exc}")
            finally:
                tag_queue.task_done()


async def _ensure_admin_user():
    async with AsyncSessionLocal() as db:
        svc = AuthService(db)
        if await svc.get_user_by_username("admin") is None:
            from backend.app.utils.passwords import hash_password
            db.add(User(
                username="admin",
                email="admin@localhost",
                hashed_password=hash_password("admin"),
                is_admin=True,
            ))
            await db.commit()


@asynccontextmanager
async def lifespan(_api: FastAPI):
    await init_db()
    await _ensure_admin_user()
    tagger.load()
    set_tag_queue(tag_queue)
    worker = asyncio.create_task(tagging_worker())
    yield
    worker.cancel()
    try:
        await worker
    except asyncio.CancelledError:
        pass


api = FastAPI(
    title="Zukan",
    version=API_VERSION,
    description=(
        "Zukan API for authentication, media management, albums, tags, and administration. "
    ),
    terms_of_service="https://zukan.example.com/terms",
    contact={
        "name": "starsbit",
        "url": "https://github.com/starsbit/",
    },
    license_info={
        "name": "MIT",
        "identifier": "MIT",
    },
    openapi_tags=OPENAPI_TAGS,
    servers=OPENAPI_SERVERS,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

api.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    return response


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", str(uuid.uuid4()))


@api.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {}
    message = detail.get("message") or detail.get("detail") or "Request failed"
    payload = build_error_response(
        status_code=exc.status_code,
        code=detail.get("code", "app_error"),
        message=message,
        request_id=_request_id(request),
        trace_id=_request_id(request),
        details=detail.get("details"),
        fields=detail.get("fields"),
    )
    return JSONResponse(status_code=exc.status_code, content=payload)


@api.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    fields = []
    for err in exc.errors():
        loc = [str(v) for v in err.get("loc", []) if v not in {"body", "query", "path", "header", "cookie"}]
        fields.append(
            {
                "field": ".".join(loc) if loc else "request",
                "message": err.get("msg", "Invalid value"),
                "type": err.get("type"),
            }
        )

    payload = build_error_response(
        status_code=422,
        code="validation_error",
        message="Request validation failed",
        request_id=_request_id(request),
        trace_id=_request_id(request),
        details={"error_count": len(fields)},
        fields=fields,
    )
    return JSONResponse(status_code=422, content=payload)


@api.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        message = exc.detail.get("message") or exc.detail.get("detail") or "Request failed"
        payload = build_error_response(
            status_code=exc.status_code,
            code=exc.detail.get("code", "http_error"),
            message=message,
            request_id=_request_id(request),
            trace_id=_request_id(request),
            details=exc.detail.get("details"),
            fields=exc.detail.get("fields"),
        )
    else:
        payload = build_error_response(
            status_code=exc.status_code,
            code="http_error",
            message=str(exc.detail),
            request_id=_request_id(request),
            trace_id=_request_id(request),
        )
    return JSONResponse(status_code=exc.status_code, content=payload, headers=exc.headers)


v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(auth.router)
v1_router.include_router(users.router)
v1_router.include_router(config.router)
v1_router.include_router(media.router)
v1_router.include_router(tags.router)
v1_router.include_router(albums.router)
v1_router.include_router(admin.router)
v1_router.include_router(batches.router)
v1_router.include_router(notifications.router)
api.include_router(v1_router)


@api.get("/openapi.json", include_in_schema=False)
async def openapi_schema(_: User = Depends(docs_user)):
    if api.openapi_schema is None:
        schema = get_openapi(
            title=api.title,
            version=api.version,
            description=api.description,
            routes=api.routes,
            tags=OPENAPI_TAGS,
            servers=OPENAPI_SERVERS,
            terms_of_service=api.terms_of_service,
            contact=api.contact,
            license_info=api.license_info,
        )
        schema["externalDocs"] = OPENAPI_EXTERNAL_DOCS
        api.openapi_schema = schema
    return JSONResponse(api.openapi_schema)


@api.get("/docs", include_in_schema=False)
async def swagger_ui(_: User = Depends(docs_user)):
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title=f"{api.title} - Swagger UI",
        oauth2_redirect_url="/docs/oauth2-redirect",
    )


@api.get("/docs/oauth2-redirect", include_in_schema=False)
async def swagger_ui_redirect(_: User = Depends(docs_user)):
    return get_swagger_ui_oauth2_redirect_html()


@api.get("/redoc", include_in_schema=False)
async def redoc_ui(_: User = Depends(docs_user)):
    return get_redoc_html(
        openapi_url="/openapi.json",
        title=f"{api.title} - ReDoc",
    )
