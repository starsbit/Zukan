import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.models.auth import User
from backend.app.routers.deps import current_user
from backend.app.schemas import AUTHENTICATED_ERROR_RESPONSES, error_responses
from backend.app.schemas.graphs import (
    CharacterGraphResponse,
    CharacterGraphSearchResult,
    GraphSeriesMode,
)
from backend.app.services.character_graph import CharacterGraphService

router = APIRouter(prefix="/graphs", tags=["graphs"], responses=AUTHENTICATED_ERROR_RESPONSES)


@router.get(
    "/characters/search",
    response_model=list[CharacterGraphSearchResult],
    summary="Search Character Graph Nodes",
    description="Return owner-scoped character suggestions for the personal character similarity graph.",
)
async def search_character_graph_nodes(
    q: str = Query(min_length=1, description="Search text for owner-scoped character names."),
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CharacterGraphService(db).search_characters(user, q=q, limit=limit)


@router.get(
    "/characters",
    response_model=CharacterGraphResponse,
    summary="Character Similarity Graph",
    description="Return a personal-library character-to-character similarity graph based on media embeddings.",
    responses=error_responses(404, 422),
)
async def get_character_graph(
    center_entity_id: uuid.UUID | None = Query(default=None),
    center_name: str | None = Query(default=None, min_length=1),
    limit: int = Query(default=80, ge=1, le=300),
    min_similarity: float = Query(default=0.70, ge=0.0, le=1.0),
    series_mode: GraphSeriesMode = Query(default="any"),
    sample_size: int = Query(default=6, ge=1, le=24),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CharacterGraphService(db).get_character_graph(
        user,
        center_entity_id=center_entity_id,
        center_name=center_name,
        limit=limit,
        min_similarity=min_similarity,
        series_mode=series_mode,
        sample_size=sample_size,
    )
