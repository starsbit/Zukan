import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
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
from backend.app.services.media import set_tag_queue
from backend.app.services.media.lifecycle import MediaLifecycleService
from backend.app.services.media.processing import MediaProcessingService
from backend.app.services.media.query import MediaQueryService
from backend.app.services.media.upload import MediaUploadService
from backend.app.services.auth import AuthService
from backend.app.services.tags import TagService
from backend.app.ml.tagger import tagger
from backend.app.ml.ocr import ocr_backend


def configure_logging() -> None:
    level_name = "INFO"
    level = getattr(logging, level_name, logging.INFO)
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        logging.basicConfig(
            level=level,
            format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        )
    else:
        root_logger.setLevel(level)


configure_logging()
logger = logging.getLogger("backend.app")

tag_queue: asyncio.Queue = asyncio.Queue()

API_VERSION = "0.1.0"
OPENAPI_TAGS = [
    {"name": "v1", "description": "Version 1 public API endpoints under /api/v1."},
    {"name": "auth", "description": "Authentication and token lifecycle endpoints."},
    {"name": "users", "description": "Current-user profile read/update operations."},
    {"name": "media", "description": "Media upload, filtering, metadata mutation, and download operations."},
    {"name": "albums", "description": "Album management, sharing, and album-scoped media operations."},
    {"name": "tags", "description": "Tag browsing, filtering utilities, and tag management actions."},
    {"name": "admin", "description": "Administrative controls, diagnostics, and global announcement publishing. Admin authentication required."},
    {"name": "batches", "description": "Import and processing batch visibility endpoints."},
    {"name": "notifications", "description": "User-targeted inbox notification endpoints under /me/notifications."},
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
                query = MediaQueryService(db)
                processing = MediaProcessingService(db, query)
                upload_service = MediaUploadService(db, processing, query)
                if media_item.tagging_status in ("pending", "processing"):
                    await TagService(db, tagger).tag_media(media_id)
                await processing.run_ocr_for_media(media_id, ocr_backend)
                await upload_service.mark_upload_batch_item_done(media_id)

            except Exception as exc:
                await db.rollback()
                async with AsyncSessionLocal() as err_db:
                    query = MediaQueryService(err_db)
                    processing = MediaProcessingService(err_db, query)
                    upload_service = MediaUploadService(err_db, processing, query)
                    await processing.mark_tagging_failure(media_id, exc)
                    await upload_service.mark_upload_batch_item_failed(media_id, str(exc))
                logger.exception("Tagging failed for media_id=%s", media_id)
            finally:
                tag_queue.task_done()


async def trash_purge_worker() -> None:
    interval_seconds = max(60, settings.trash_purge_interval_seconds)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                query = MediaQueryService(db)
                lifecycle = MediaLifecycleService(db, query)
                purged = await lifecycle.purge_expired_trash()
                if purged:
                    logger.info("Purged %s expired trashed media records", purged)
        except Exception:
            logger.exception("Scheduled trash purge run failed")
        await asyncio.sleep(interval_seconds)


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
            logger.info("Bootstrapped default admin user")


@asynccontextmanager
async def lifespan(_api: FastAPI):
    logger.info("Application startup initiated")
    await init_db()
    await _ensure_admin_user()
    tagger.load()
    ocr_backend.load()
    set_tag_queue(tag_queue)
    worker = asyncio.create_task(tagging_worker())
    purge_worker = asyncio.create_task(trash_purge_worker())
    logger.info("Background tagging worker started")
    logger.info("Background trash purge worker started")
    yield
    logger.info("Application shutdown initiated")
    worker.cancel()
    purge_worker.cancel()
    try:
        await worker
    except asyncio.CancelledError:
        logger.info("Background tagging worker stopped")
    try:
        await purge_worker
    except asyncio.CancelledError:
        logger.info("Background trash purge worker stopped")


api = FastAPI(
    title="Zukan",
    version=API_VERSION,
    description=(
        "Zukan API for authentication, media management, albums, tags, and administration. "
    ),
    contact={
        "name": "starsbit",
        "url": "https://github.com/starsbit/",
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
    start = time.perf_counter()
    response = None
    try:
        response = await call_next(request)
        return response
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        status_code = response.status_code if response is not None else 500
        logger.info(
            "HTTP %s %s -> %s %.2fms request_id=%s",
            request.method,
            request.url.path,
            status_code,
            elapsed_ms,
            request_id,
        )
        if response is not None:
            response.headers["x-request-id"] = request_id


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
    logger.warning(
        "AppError status=%s code=%s path=%s request_id=%s",
        exc.status_code,
        payload.get("code"),
        request.url.path,
        _request_id(request),
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
    logger.warning(
        "ValidationError status=422 path=%s error_count=%s request_id=%s",
        request.url.path,
        len(fields),
        _request_id(request),
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
    log_fn = logger.error if exc.status_code >= 500 else logger.warning
    log_fn(
        "HTTPException status=%s code=%s path=%s request_id=%s",
        exc.status_code,
        payload.get("code"),
        request.url.path,
        _request_id(request),
    )
    return JSONResponse(status_code=exc.status_code, content=payload, headers=exc.headers)


v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(auth.router, tags=["v1"])
v1_router.include_router(users.router, tags=["v1"])
v1_router.include_router(config.router, tags=["v1"])
v1_router.include_router(media.router, tags=["v1"])
v1_router.include_router(tags.router, tags=["v1"])
v1_router.include_router(albums.router, tags=["v1"])
v1_router.include_router(admin.router, tags=["v1"])
v1_router.include_router(batches.router, tags=["v1"])
v1_router.include_router(notifications.router, tags=["v1"])
api.include_router(v1_router)


@api.get("/openapi.json", include_in_schema=False)
async def openapi_schema(_: User = Depends(docs_user)):
    if api.openapi_schema is None:
        try:
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
            api.openapi_schema = jsonable_encoder(schema)
        except Exception:
            logger.exception("Failed to generate OpenAPI schema")
            raise
    return JSONResponse(content=api.openapi_schema)


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
