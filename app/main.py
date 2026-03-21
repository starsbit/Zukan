import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, init_db
from app.models import Image, ImageTag, Tag, User
from app.routers import auth, images, tags
from app.routers import admin, albums, bulk
from app.routers.images import set_tag_queue
from app.services.auth import get_user_by_username, hash_password
from app.services.tagger import tagger

tag_queue: asyncio.Queue = asyncio.Queue()


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

                predictions, is_nsfw = await tagger.predict(image.filepath)

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
                for pred in predictions:
                    tag_result = await db.execute(select(Tag).where(Tag.name == pred["name"]))
                    tag = tag_result.scalar_one_or_none()
                    if tag is None:
                        tag = Tag(name=pred["name"], category=pred["category"], image_count=0)
                        db.add(tag)
                        await db.flush()
                    tag.image_count += 1
                    db.add(ImageTag(image_id=image_id, tag_id=tag.id, confidence=pred["confidence"]))
                    tag_names.append(pred["name"])

                image.tags = tag_names
                image.is_nsfw = is_nsfw
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


app = FastAPI(title="Zukan", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(bulk.router)
app.include_router(images.router)
app.include_router(tags.router)
app.include_router(albums.router)
app.include_router(admin.router)
