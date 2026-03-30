from __future__ import annotations

import uuid

import pytest

from backend.app.models.albums import Album, AlbumMedia, AlbumShare, AlbumShareInvite, AlbumShareInviteStatus, AlbumShareRole
from backend.app.repositories.albums import AlbumRepository


@pytest.mark.asyncio
async def test_album_repository_access_and_media_queries(db_session, make_user, make_media):
    owner = await make_user(username="owner", email="owner@example.com")
    shared_user = await make_user(username="shared", email="shared@example.com")

    album = Album(owner_id=owner.id, name="A", description=None)
    db_session.add(album)
    await db_session.flush()

    media1 = await make_media(uploader_id=owner.id, deleted=False)
    media2 = await make_media(uploader_id=owner.id, deleted=True)
    db_session.add(AlbumMedia(album_id=album.id, media_id=media1.id, position=1))
    db_session.add(AlbumMedia(album_id=album.id, media_id=media2.id, position=2))
    share = AlbumShare(album_id=album.id, user_id=shared_user.id, role=AlbumShareRole.editor, shared_by_user_id=owner.id)
    db_session.add(share)
    invite = AlbumShareInvite(
        album_id=album.id,
        user_id=shared_user.id,
        role=AlbumShareRole.viewer,
        status=AlbumShareInviteStatus.pending,
        invited_by_user_id=owner.id,
    )
    db_session.add(invite)
    await db_session.flush()

    repo = AlbumRepository(db_session)
    assert (await repo.get_by_id(album.id)).id == album.id
    assert (await repo.get_share(album.id, shared_user.id)).role == AlbumShareRole.editor
    assert await repo.count_media(album.id) == 2
    assert await repo.get_max_position(album.id) == 2
    assert await repo.get_existing_media_ids(album.id) == {media1.id, media2.id}
    assert (await repo.get_album_media_item(album.id, media1.id)).position == 1
    assert len(await repo.get_album_media_items(album.id, [media1.id, media2.id])) == 2
    assert await repo.get_first_media_id(album.id) == media1.id
    assert await repo.get_album_preview_media_ids([album.id]) == {album.id: [media1.id, media2.id]}

    assert await repo.count_accessible(owner.id) == 1
    assert await repo.count_accessible(shared_user.id) == 1
    listed = await repo.list_accessible(shared_user.id, offset=0, limit=10, order_expr=Album.name.asc())
    assert [a.id for a in listed] == [album.id]
    shares = await repo.get_shares_for_user(shared_user.id, [album.id])
    assert shares[0].role == AlbumShareRole.editor
    invites = await repo.get_pending_invites_for_user(shared_user.id, [album.id])
    assert invites[0].status == AlbumShareInviteStatus.pending
    owners = await repo.get_owner_summaries([owner.id])
    assert owners[owner.id].username == "owner"

    downloadable = await repo.get_media_for_download(album.id)
    assert [m.id for m in downloadable] == [media1.id]
