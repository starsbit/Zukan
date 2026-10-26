from backend.app.database.base import Base
import backend.app.main

def test_single_owner_schema_surface():
    assert 'singleton' in Base.metadata.tables['users'].c
    for table in ('media', 'albums', 'tags', 'owned_entities', 'media_embeddings', 'import_batches', 'notifications'):
        assert not {'user_id', 'uploader_id', 'owner_id', 'owner_user_id', 'visibility'}.intersection(Base.metadata.tables[table].c.keys())
    assert not any((n.startswith(('gacha_', 'trade_', 'user_collection', 'album_share')) for n in Base.metadata.tables))
