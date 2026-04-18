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
from sqlalchemy import exists, select

from backend.app.errors.error import AppError, build_error_response

from backend.app.database import AsyncSessionLocal, init_db
from backend.app.config import settings
from backend.app.logging_config import configure_logging
from backend.app.models.auth import User
from backend.app.models.media import Media
from backend.app.models.processing import BatchType, ImportBatch, ImportBatchItem, ItemStatus
from backend.app.models import notifications as _notifications_models  # noqa: F401
from backend.app.models import processing as _processing_models  # noqa: F401
from backend.app.runtime import health_monitor
from backend.app.routers import admin, albums, auth, batches, config, media, notifications, tags, users
from backend.app.routers.deps import docs_user
from backend.app.services.media import set_tag_queue
from backend.app.services.media.lifecycle import MediaLifecycleService
from backend.app.services.media.processing import MediaProcessingService
from backend.app.services.media.query import MediaQueryService
from backend.app.services.media.upload import MediaUploadService
from backend.app.services.auth import AuthService
from backend.app.services.tags import TagService
from backend.app.services.update_check import update_check_worker
from backend.app.ml.tagger import tagger
from backend.app.ml.ocr import ocr_backend


configure_logging(settings.log_level)
logger = logging.getLogger("backend.app")

tag_queue: asyncio.Queue = asyncio.Queue()


class _MlStartupState:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._ready = asyncio.Event()
        self._error: Exception | None = None

    def mark_ready(self) -> None:
        self._error = None
        self._ready.set()

    def mark_failed(self, exc: Exception) -> None:
        self._error = exc
        self._ready.set()

    async def wait_until_ready(self) -> None:
        await self._ready.wait()
        if self._error is not None:
            raise RuntimeError("ML services failed to initialize") from self._error


ml_startup_state = _MlStartupState()

API_VERSION = settings.app_version
OPENAPI_TAGS = [
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
    {"url": "/", "description": "Current origin"},
    {"url": "http://localhost:8000", "description": "Local development server"},
    {"url": "http://127.0.0.1:8000", "description": "Local loopback server"},
]
OPENAPI_EXTERNAL_DOCS = {
    "description": "Public API behavior contract",
    "url": "/redoc",
}
API_KEY_AUTH_DESCRIPTION = (
    "Authenticate with `Authorization: Bearer <token>`. "
    "The bearer token may be either a JWT access token from `/api/v1/auth/login` "
    "or a user-generated API key from Account Settings."
)


async def tagging_worker():
    while True:
        media_id: uuid.UUID = await tag_queue.get()
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(select(Media).where(Media.id == media_id))
                media_item = result.scalar_one_or_none()
                if media_item is None:
                    continue
                await ml_startup_state.wait_until_ready()
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
        has_admin_result = await db.execute(select(exists().where(User.is_admin.is_(True))))
        has_admin = bool(has_admin_result.scalar())
        if not has_admin:
            from backend.app.utils.passwords import hash_password
            db.add(User(
                username="admin",
                email="admin@localhost",
                hashed_password=hash_password("admin"),
                is_admin=True,
            ))
            await db.commit()
            logger.info("Bootstrapped default admin user")


async def _recover_pending_media_jobs(queue: asyncio.Queue) -> int:
    async with AsyncSessionLocal() as db:
        pending_media = (
            (
                await db.execute(
                    select(Media).where(
                        Media.deleted_at.is_(None),
                        Media.tagging_status.in_(["pending", "processing"]),
                    )
                )
            )
            .scalars()
            .all()
        )
        pending_upload_items = (
            (
                await db.execute(
                    select(ImportBatchItem)
                    .join(ImportBatch, ImportBatch.id == ImportBatchItem.batch_id)
                    .where(
                        ImportBatch.type == BatchType.upload,
                        ImportBatchItem.media_id.is_not(None),
                        ImportBatchItem.status.in_([ItemStatus.pending, ItemStatus.processing]),
                    )
                )
            )
            .scalars()
            .all()
        )

        updated = False
        for media in pending_media:
            if media.tagging_status == "processing":
                media.tagging_status = "pending"
                updated = True

        for batch_item in pending_upload_items:
            if batch_item.status == ItemStatus.processing:
                batch_item.status = ItemStatus.pending
                updated = True

        if updated:
            await db.commit()

    ordered_media_ids: list[uuid.UUID] = []
    seen_media_ids: set[uuid.UUID] = set()

    for batch_item in pending_upload_items:
        media_id = batch_item.media_id
        if media_id is None or media_id in seen_media_ids:
            continue
        seen_media_ids.add(media_id)
        ordered_media_ids.append(media_id)

    for media in pending_media:
        media_id = media.id
        if media_id in seen_media_ids:
            continue
        seen_media_ids.add(media_id)
        ordered_media_ids.append(media_id)

    for media_id in ordered_media_ids:
        await queue.put(media_id)

    return len(ordered_media_ids)


async def _initialize_ml_services() -> None:
    try:
        logger.info("Startup phase: loading tagger model")
        await asyncio.to_thread(tagger.load)
        logger.info("Startup phase complete: loading tagger model")

        logger.info("Startup phase: loading OCR model")
        await asyncio.to_thread(ocr_backend.load)
        logger.info("Startup phase complete: loading OCR model")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        ml_startup_state.mark_failed(exc)
        logger.exception("Background ML startup failed")
        return

    ml_startup_state.mark_ready()
    logger.info("Background ML startup completed successfully")


def _augment_openapi_security(schema: dict) -> dict:
    components = schema.setdefault("components", {})
    security_schemes = components.setdefault("securitySchemes", {})
    for scheme in security_schemes.values():
        if not isinstance(scheme, dict):
            continue
        scheme_type = scheme.get("type")
        if scheme_type in {"oauth2", "http"}:
            description = scheme.get("description")
            if description:
                if API_KEY_AUTH_DESCRIPTION not in description:
                    scheme["description"] = f"{description}\n\n{API_KEY_AUTH_DESCRIPTION}"
            else:
                scheme["description"] = API_KEY_AUTH_DESCRIPTION

    return schema


@asynccontextmanager
async def lifespan(_api: FastAPI):
    logger.info("Application startup initiated")
    startup_started_at = time.perf_counter()
    worker: asyncio.Task | None = None
    purge_worker: asyncio.Task | None = None
    update_worker: asyncio.Task | None = None
    ml_worker: asyncio.Task | None = None
    ml_startup_state.reset()
    try:
        logger.info("Startup phase: running database migrations")
        await init_db()
        logger.info("Startup phase complete: database migrations")

        logger.info("Startup phase: ensuring admin user")
        await _ensure_admin_user()
        logger.info("Startup phase complete: ensuring admin user")

        logger.info("Startup phase: scheduling background ML initialization")
        ml_worker = asyncio.create_task(_initialize_ml_services())
        logger.info("Startup phase complete: scheduling background ML initialization")

        logger.info("Startup phase: wiring background services")
        set_tag_queue(tag_queue)
        health_monitor.start()
        recovered_count = await _recover_pending_media_jobs(tag_queue)
        worker = asyncio.create_task(tagging_worker())
        purge_worker = asyncio.create_task(trash_purge_worker())
        update_worker = asyncio.create_task(update_check_worker())
        logger.info("Background tagging worker started")
        if recovered_count:
            logger.info("Recovered %s pending media jobs after startup", recovered_count)
        logger.info("Background trash purge worker started")
        logger.info("Application startup completed successfully; ML initialization continues in background")
        logger.info("Application startup duration_seconds=%.2f", time.perf_counter() - startup_started_at)

        yield
    except Exception:
        logger.exception("Application startup failed")
        raise
    finally:
        logger.info("Application shutdown initiated")
        if worker is not None:
            worker.cancel()
        if purge_worker is not None:
            purge_worker.cancel()
        if update_worker is not None:
            update_worker.cancel()
        if ml_worker is not None:
            ml_worker.cancel()
        await health_monitor.stop()
        if worker is not None:
            try:
                await worker
            except asyncio.CancelledError:
                logger.info("Background tagging worker stopped")
        if purge_worker is not None:
            try:
                await purge_worker
            except asyncio.CancelledError:
                logger.info("Background trash purge worker stopped")
        if update_worker is not None:
            try:
                await update_worker
            except asyncio.CancelledError:
                logger.info("Background update check worker stopped")
        if ml_worker is not None:
            try:
                await ml_worker
            except asyncio.CancelledError:
                logger.info("Background ML startup task stopped")


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


def _json_error_response(*, status_code: int, payload: dict, headers: dict[str, str] | None = None) -> JSONResponse:
    response_headers = dict(headers or {})
    request_id = payload.get("request_id")
    if isinstance(request_id, str) and request_id:
        response_headers.setdefault("x-request-id", request_id)
    return JSONResponse(status_code=status_code, content=payload, headers=response_headers or None)


@api.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    request_id = _request_id(request)
    detail = exc.detail if isinstance(exc.detail, dict) else {}
    message = detail.get("message") or detail.get("detail") or "Request failed"
    payload = build_error_response(
        status_code=exc.status_code,
        code=detail.get("code", "app_error"),
        message=message,
        request_id=request_id,
        trace_id=request_id,
        details=detail.get("details"),
        fields=detail.get("fields"),
    )
    logger.warning(
        "AppError status=%s code=%s path=%s request_id=%s",
        exc.status_code,
        payload.get("code"),
        request.url.path,
        request_id,
    )
    return _json_error_response(status_code=exc.status_code, payload=payload)


@api.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = _request_id(request)
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
        request_id=request_id,
        trace_id=request_id,
        details={"error_count": len(fields)},
        fields=fields,
    )
    logger.warning(
        "ValidationError status=422 path=%s error_count=%s request_id=%s",
        request.url.path,
        len(fields),
        request_id,
    )
    return _json_error_response(status_code=422, payload=payload)


@api.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    request_id = _request_id(request)
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        message = exc.detail.get("message") or exc.detail.get("detail") or "Request failed"
        payload = build_error_response(
            status_code=exc.status_code,
            code=exc.detail.get("code", "http_error"),
            message=message,
            request_id=request_id,
            trace_id=request_id,
            details=exc.detail.get("details"),
            fields=exc.detail.get("fields"),
        )
    else:
        payload = build_error_response(
            status_code=exc.status_code,
            code="http_error",
            message=str(exc.detail),
            request_id=request_id,
            trace_id=request_id,
        )
    log_fn = logger.error if exc.status_code >= 500 else logger.warning
    log_fn(
        "HTTPException status=%s code=%s path=%s request_id=%s",
        exc.status_code,
        payload.get("code"),
        request.url.path,
        request_id,
    )
    return _json_error_response(status_code=exc.status_code, payload=payload, headers=exc.headers)


@api.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = _request_id(request)
    logger.exception(
        "Unhandled exception path=%s method=%s request_id=%s",
        request.url.path,
        request.method,
        request_id,
    )
    payload = build_error_response(
        status_code=500,
        code="internal_server_error",
        message="Internal server error",
        request_id=request_id,
        trace_id=request_id,
    )
    return _json_error_response(status_code=500, payload=payload)


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
            schema = _augment_openapi_security(schema)
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
