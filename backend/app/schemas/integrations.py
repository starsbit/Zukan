from datetime import datetime

from pydantic import BaseModel, Field


class AniListIntegrationRead(BaseModel):
    service: str = "anilist"
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AniListIntegrationUpsert(BaseModel):
    token: str = Field(min_length=1, max_length=2048)
