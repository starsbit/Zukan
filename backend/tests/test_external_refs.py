import uuid
from backend.app.models.auth import User
from backend.app.schemas import ExternalRefCreate, MediaUpdate
from backend.app.services import media as media_service
from backend.app.models.media import MediaEntity, MediaExternalRef
from sqlalchemy import text

def test_external_refs_default_empty_in_media_detail(api):
    user = api.register_and_login("extref-empty-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "extref-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    detail = api.client.get(f"/media/{blue['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["external_refs"] == []


def test_external_refs_can_be_set_and_read(api):
    user = api.register_and_login("extref-set-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "extref-set-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    patch = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={
            "external_refs": [
                {"provider": "pixiv", "external_id": "12345", "url": "https://pixiv.net/12345"},
                {"provider": "danbooru", "external_id": "67890"},
            ]
        },
    )
    assert patch.status_code == 200

    detail = api.client.get(f"/media/{blue['id']}", headers=headers)
    assert detail.status_code == 200
    refs = detail.json()["external_refs"]
    assert len(refs) == 2
    providers = {r["provider"] for r in refs}
    assert providers == {"pixiv", "danbooru"}


def test_external_refs_replace_on_update(api):
    user = api.register_and_login("extref-replace-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "extref-replace-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"external_refs": [{"provider": "pixiv", "external_id": "111"}]},
    )

    api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"external_refs": [{"provider": "anilist", "external_id": "999"}]},
    )

    detail = api.client.get(f"/media/{blue['id']}", headers=headers)
    refs = detail.json()["external_refs"]
    assert len(refs) == 1
    assert refs[0]["provider"] == "anilist"


def test_external_refs_can_be_cleared(api):
    user = api.register_and_login("extref-clear-user")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "extref-clear-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"external_refs": [{"provider": "pixiv", "external_id": "1"}]},
    )

    cleared = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"external_refs": []},
    )
    assert cleared.status_code == 200

    detail = api.client.get(f"/media/{blue['id']}", headers=headers)
    assert detail.json()["external_refs"] == []


def test_external_refs_service_layer(api):
    user = api.register_and_login("extref-service-user")
    blue = api.upload_media(user["access_token"], "extref-svc-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))
    blue_id = uuid.UUID(str(blue["id"]))
    user_id = uuid.UUID(user["user"]["id"])

    async def _exercise(session):
        db_user = await session.get(User, user_id)
        updated = await media_service.update_media_metadata(
            session,
            blue_id,
            db_user,
            MediaUpdate(external_refs=[
                ExternalRefCreate(provider="vndb", external_id="v42", url="https://vndb.org/v42"),
            ]),
        )
        assert len(updated.external_refs) == 1
        assert updated.external_refs[0].provider == "vndb"
        assert updated.external_refs[0].external_id == "v42"

    api.run_db(_exercise)

def test_media_entity_model_exists():
    assert MediaEntity.__tablename__ == "media_entities"


def test_media_external_ref_model_exists():
    assert MediaExternalRef.__tablename__ == "media_external_refs"


def test_media_entities_table_created_in_db(api):
    async def _check(session):
        result = await session.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_name = 'media_entities'")
        )
        assert result.scalar() == 1

    api.run_db(_check)


def test_media_external_refs_table_created_in_db(api):
    async def _check(session):
        result = await session.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_name = 'media_external_refs'")
        )
        assert result.scalar() == 1

    api.run_db(_check)


def test_version_column_exists_on_all_tables(api):
    async def _check(session):
        for table, col in [("media", "version"), ("albums", "version"), ("users", "version")]:
            result = await session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = :table AND column_name = :col"
                ),
                {"table": table, "col": col},
            )
            assert result.scalar() == 1, f"Column {col} missing on {table}"

    api.run_db(_check)