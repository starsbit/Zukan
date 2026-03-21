import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html, get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy import select

from app.database import AsyncSessionLocal, init_db
from app.models import Media, User
from app.routers import admin, albums, auth, media, tags, users
from app.services.auth import authenticate_basic_user, get_user_by_username, hash_password
from app.services.media import set_tag_queue, tag_media
from app.services.tagger import tagger

tag_queue: asyncio.Queue = asyncio.Queue()
docs_basic = HTTPBasic()


async def tagging_worker():
    while True:
        media_id: uuid.UUID = await tag_queue.get()
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(select(Media).where(Media.id == media_id))
                media_item = result.scalar_one_or_none()
                if media_item is None:
                    continue
                await tag_media(db, media_id)

            except Exception as exc:
                await db.rollback()
                async with AsyncSessionLocal() as err_db:
                    err_result = await err_db.execute(select(Media).where(Media.id == media_id))
                    err_media = err_result.scalar_one_or_none()
                    if err_media:
                        err_media.tagging_status = "failed"
                        await err_db.commit()
                print(f"Tagging failed for {media_id}: {exc}")
            finally:
                tag_queue.task_done()


async def _ensure_admin_user():
    async with AsyncSessionLocal() as db:
        if await get_user_by_username(db, "admin") is None:
            db.add(User(
                username="admin",
                email="admin@localhost",
                hashed_password=hash_password("admin"),
                is_admin=True,
            ))
            await db.commit()


async def docs_user(credentials: HTTPBasicCredentials = Depends(docs_basic)) -> User:
    async with AsyncSessionLocal() as db:
        user = await authenticate_basic_user(db, credentials.username, credentials.password)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized",
                headers={"WWW-Authenticate": "Basic"},
            )
        return user


@asynccontextmanager
async def lifespan(app: FastAPI):
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


app = FastAPI(title="Zukan", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(media.router)
app.include_router(tags.router)
app.include_router(albums.router)
app.include_router(admin.router)


@app.get("/openapi.json", include_in_schema=False)
async def openapi_schema(_: User = Depends(docs_user)):
    return JSONResponse(get_openapi(title=app.title, version="0.1.0", routes=app.routes))


@app.get("/docs", include_in_schema=False)
async def swagger_ui(_: User = Depends(docs_user)):
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title=f"{app.title} - Swagger UI",
        oauth2_redirect_url="/docs/oauth2-redirect",
    )


@app.get("/docs/oauth2-redirect", include_in_schema=False)
async def swagger_ui_redirect(_: User = Depends(docs_user)):
    return get_swagger_ui_oauth2_redirect_html()


@app.get("/redoc", include_in_schema=False)
async def redoc_ui(_: User = Depends(docs_user)):
    return get_redoc_html(
        openapi_url="/openapi.json",
        title=f"{app.title} - ReDoc",
    )
