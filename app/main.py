import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html, get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, init_db
from app.models import Image, ImageTag, Tag, User
from app.routers import admin, albums, auth, images, tags, users
from app.services.auth import authenticate_basic_user, get_user_by_username, hash_password
from app.services.images import set_tag_queue
from app.services.tagger import tagger

tag_queue: asyncio.Queue = asyncio.Queue()
docs_basic = HTTPBasic()


async def tagging_worker():
    while True:
        image_id: uuid.UUID = await tag_queue.get()
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(select(Image).where(Image.id == image_id))
                image = result.scalar_one_or_none()
                if image is None:
                    continue

                image.tagging_status = "processing"
                await db.commit()

                tagging_result = await tagger.predict(image.filepath)
                image.character_name = tagging_result.character_name

                existing_its = await db.execute(
                    select(ImageTag).where(ImageTag.image_id == image_id)
                )
                old_tag_ids = [it.tag_id for it in existing_its.scalars().all()]

                if old_tag_ids:
                    old_tags = await db.execute(select(Tag).where(Tag.id.in_(old_tag_ids)))
                    for t in old_tags.scalars().all():
                        t.image_count = max(0, t.image_count - 1)
                    await db.execute(
                        delete(ImageTag).where(ImageTag.image_id == image_id)
                    )

                tag_names = []
                for prediction in tagging_result.predictions:
                    tag_result = await db.execute(select(Tag).where(Tag.name == prediction.name))
                    tag = tag_result.scalar_one_or_none()
                    if tag is None:
                        tag = Tag(name=prediction.name, category=prediction.category, image_count=0)
                        db.add(tag)
                        await db.flush()
                    tag.image_count += 1
                    db.add(ImageTag(image_id=image_id, tag_id=tag.id, confidence=prediction.confidence))
                    tag_names.append(prediction.name)

                image.tags = tag_names
                image.is_nsfw = tagging_result.is_nsfw
                image.tagging_status = "done"
                await db.commit()

            except Exception as exc:
                await db.rollback()
                async with AsyncSessionLocal() as err_db:
                    err_result = await err_db.execute(select(Image).where(Image.id == image_id))
                    err_image = err_result.scalar_one_or_none()
                    if err_image:
                        err_image.tagging_status = "failed"
                        await err_db.commit()
                print(f"Tagging failed for {image_id}: {exc}")
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
app.include_router(images.router)
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
