from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.services.tagger_settings import load_saved_tagger_backend, save_tagger_backend


@pytest.mark.asyncio
async def test_tagger_choice_round_trips_and_overwrites(db_engine):
    maker = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    with patch("backend.app.services.tagger_settings.AsyncSessionLocal", maker):
        assert await load_saved_tagger_backend() is None

        await save_tagger_backend("pixai_v1_336_int8")
        assert await load_saved_tagger_backend() == "pixai_v1_336_int8"

        await save_tagger_backend("wd_v3")
        assert await load_saved_tagger_backend() == "wd_v3"
