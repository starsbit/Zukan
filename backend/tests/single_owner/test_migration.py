import uuid
import pytest
from sqlalchemy import text, inspect
from backend.app.config import settings
from .conftest import migrate


@pytest.mark.asyncio
async def test_empty_install_and_second_start(isolated_database):
    await migrate()
    await migrate()
    async with isolated_database.connect() as db:
        assert await db.scalar(text("SELECT count(*) FROM users")) == 0
        assert (
            await db.scalar(text("SELECT version_num FROM alembic_version"))
            == "0022_single_owner"
        )

        def schema(c):
            i = inspect(c)
            for name in (
                "media",
                "albums",
                "tags",
                "owned_entities",
                "import_batches",
                "notifications",
                "media_embeddings",
            ):
                assert not {
                    "user_id",
                    "owner_id",
                    "uploader_id",
                    "owner_user_id",
                    "visibility",
                }.intersection(x["name"] for x in i.get_columns(name))
            assert not any(
                t.startswith(("album_share", "gacha_", "trade_", "user_collection"))
                for t in i.get_table_names()
            )

        await db.run_sync(schema)


@pytest.mark.asyncio
async def test_existing_libraries_merge_without_data_loss(
    isolated_database, monkeypatch
):
    await migrate("0021_storage_setup_prompt")
    owner, other = uuid.uuid4(), uuid.uuid4()
    media_ids = [uuid.uuid4() for _ in range(3)]
    albums = [uuid.uuid4(), uuid.uuid4()]
    entities = [uuid.uuid4(), uuid.uuid4()]
    async with isolated_database.begin() as db:
        for i, uid in enumerate((owner, other)):
            await db.execute(
                text(
                    "INSERT INTO users(id,username,email,hashed_password,is_admin,show_nsfw,show_sensitive,tag_confidence_threshold,version) VALUES (:id,:name,:email,'preserved-hash',false,true,false,0.6,1)"
                ),
                {"id": uid, "name": f"u{i}", "email": f"u{i}@test.test"},
            )
        for mid, uid, path in zip(
            media_ids, [owner, other, None], ["a.png", "b.png", "c.png"]
        ):
            await db.execute(
                text("""INSERT INTO media(id,uploader_id,owner_id,filename,filepath,sha256,media_type,tagging_status,thumbnail_status,poster_status,captured_at,is_nsfw,is_sensitive,version,deleted_at)
                VALUES (:id,:uid,:uid,:path,:path,'same-hash','IMAGE','DONE','DONE','NOT_APPLICABLE',now(),false,false,1,CASE WHEN CAST(:path AS varchar)='b.png' THEN now() ELSE NULL END)"""),
                {"id": mid, "uid": uid, "path": path},
            )
        for aid, uid, mid in zip(albums, [owner, other], media_ids):
            await db.execute(
                text(
                    "INSERT INTO albums(id,owner_id,name,version,cover_media_id) VALUES (:id,:uid,'Same album',1,:mid)"
                ),
                {"id": aid, "uid": uid, "mid": mid},
            )
            await db.execute(
                text(
                    "INSERT INTO album_media(album_id,media_id,position) VALUES (:aid,:mid,1)"
                ),
                {"aid": aid, "mid": mid},
            )
        for tag, uid, category in [(1, owner, 4), (2, other, 0)]:
            await db.execute(
                text(
                    "INSERT INTO tags(id,owner_user_id,name,category,media_count) VALUES (:id,:uid,'same-tag',:category,0)"
                ),
                {"id": tag, "uid": uid, "category": category},
            )
        for mid, tag in [(media_ids[0], 1), (media_ids[0], 2), (media_ids[1], 2)]:
            await db.execute(
                text(
                    "INSERT INTO media_tags(media_id,tag_id,confidence,source) VALUES (:mid,:tag,0.9,'manual')"
                ),
                {"mid": mid, "tag": tag},
            )
        for eid, uid in zip(entities, [owner, other]):
            await db.execute(
                text(
                    "INSERT INTO owned_entities(id,owner_user_id,entity_type,name,normalized_name,media_count) VALUES (:id,:uid,'character','Name','name',1)"
                ),
                {"id": eid, "uid": uid},
            )
        for mid, eid in zip(media_ids, entities):
            await db.execute(
                text(
                    "INSERT INTO media_entities(id,media_id,entity_id,entity_type,name,role,source) VALUES (:id,:mid,:eid,'character','Name','primary','manual')"
                ),
                {"id": uuid.uuid4(), "mid": mid, "eid": eid},
            )
        for uid in (owner, other):
            await db.execute(
                text("INSERT INTO user_favorites(user_id,media_id) VALUES (:uid,:mid)"),
                {"uid": uid, "mid": media_ids[0]},
            )
        await db.execute(
            text(
                "INSERT INTO notifications(id,user_id,type,title,body,is_read) VALUES (:id,:uid,'share_invite','gone','social',false),(:other,:uid,'batch_done','keep','done',false)"
            ),
            {"id": uuid.uuid4(), "other": uuid.uuid4(), "uid": other},
        )
        await db.execute(
            text(
                "INSERT INTO import_batches(id,user_id,type,status,total_items,queued_items,processing_items,done_items,failed_items) VALUES (:id,:uid,'upload','pending',1,1,0,0,0)"
            ),
            {"id": uuid.uuid4(), "uid": other},
        )
        await db.execute(
            text(
                "INSERT INTO media_embeddings(media_id,uploader_id,embedding,model_version) VALUES (:mid,:uid,CAST(:vector AS vector),'test')"
            ),
            {
                "mid": media_ids[1],
                "uid": other,
                "vector": "[" + ",".join(["0.1"] * 512) + "]",
            },
        )
    for selected in ("", str(uuid.uuid4())):
        monkeypatch.setattr(settings, "single_user_owner_id", selected)
        with pytest.raises(RuntimeError):
            await migrate()
        async with isolated_database.connect() as db:
            assert await db.scalar(text("SELECT count(*) FROM users")) == 2
            assert await db.scalar(text("SELECT count(*) FROM media_tags")) == 3
            assert (
                await db.scalar(text("SELECT version_num FROM alembic_version"))
                == "0021_storage_setup_prompt"
            )
    monkeypatch.setattr(settings, "single_user_owner_id", str(owner))
    # Failure after the destructive merge work must roll back every change.
    from alembic.operations import Operations
    original_constraint = Operations.create_unique_constraint
    def fail_during_merge(self, name, *args, **kwargs):
        if name == "uq_tags_name":
            raise RuntimeError("injected migration failure")
        return original_constraint(self, name, *args, **kwargs)
    with monkeypatch.context() as fail_patch:
        fail_patch.setattr(Operations, "create_unique_constraint", fail_during_merge)
        with pytest.raises(RuntimeError, match="injected migration failure"):
            await migrate()
    async with isolated_database.connect() as db:
        assert await db.scalar(text("SELECT count(*) FROM users")) == 2
        assert await db.scalar(text("SELECT count(*) FROM tags")) == 2
        assert await db.scalar(text("SELECT count(*) FROM media_tags")) == 3
        assert await db.scalar(text("SELECT count(*) FROM notifications")) == 2
    await migrate()
    async with isolated_database.connect() as db:
        assert (
            await db.execute(
                text("SELECT id,hashed_password,tag_confidence_threshold FROM users")
            )
        ).one() == (owner, "preserved-hash", 0.6)
        assert set((await db.execute(text("SELECT id FROM media"))).scalars()) == set(
            media_ids
        )
        assert (
            await db.execute(text("SELECT filepath FROM media ORDER BY filepath"))
        ).scalars().all() == ["a.png", "b.png", "c.png"]
        assert (
            await db.scalar(
                text("SELECT count(*) FROM media WHERE deleted_at IS NOT NULL")
            )
            == 1
        )
        for table, count in [
            ("albums", 2),
            ("album_media", 2),
            ("media_embeddings", 1),
            ("import_batches", 1),
            ("tags", 1),
            ("owned_entities", 1),
            ("user_favorites", 1),
            ("notifications", 1),
            ("media_tags", 2),
        ]:
            assert await db.scalar(text(f"SELECT count(*) FROM {table}")) == count
        assert await db.scalar(text("SELECT category FROM tags")) == 4
        assert (
            await db.scalar(
                text("SELECT count(DISTINCT entity_id) FROM media_entities")
            )
            == 1
        )
    await migrate()
