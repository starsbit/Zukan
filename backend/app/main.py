import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html, get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select

from backend.app.errors import AppError

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
from backend.app.ml.tagger import tagger, WDTagger

tag_queue: asyncio.Queue = asyncio.Queue()


async def tagging_worker():
    while True:
        media_id: uuid.UUID = await tag_queue.get()
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(select(Media).where(Media.id == media_id))
                media_item = result.scalar_one_or_none()
                if media_item is None:
                    continue
                await TagService(db, WDTagger()).tag_media(db, media_id)

            except Exception as exc:
                await db.rollback()
                async with AsyncSessionLocal() as err_db:
                    await MediaService(db).mark_tagging_failure(media_id, exc)
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


api = FastAPI(title="Zukan", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

api.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api.exception_handler(AppError)
async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.detail)


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
    return JSONResponse(get_openapi(title=api.title, version="0.1.0", routes=api.routes))


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
