from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.auth import User
from backend.app.routers.deps import admin_user, current_user
from backend.app.schemas import ADMIN_ERROR_RESPONSES, AUTHENTICATED_ERROR_RESPONSES, error_responses
from backend.app.schemas.gacha import (
    GachaCurrencyBalanceRead,
    GachaDailyClaimResponse,
    GachaPullRead,
    GachaPullRequest,
    GachaStatsResponse,
    RarityRecalculationResponse,
)
from backend.app.services.gacha import GachaService
from backend.app.utils.rate_limit import rate_limit

router = APIRouter(prefix="/gacha", tags=["gacha"], responses=AUTHENTICATED_ERROR_RESPONSES)


@router.post(
    "/pull",
    response_model=GachaPullRead,
    status_code=status.HTTP_201_CREATED,
    summary="Pull Gacha Media",
    responses=error_responses(409, 422, 429),
    dependencies=[
        Depends(
            rate_limit(
                max_requests=settings.gacha_pull_rate_limit_requests,
                window_seconds=settings.gacha_pull_rate_limit_window_seconds,
                scope="gacha_pull",
            )
        )
    ],
)
async def pull_gacha(
    body: GachaPullRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await GachaService(db).pull(user, mode=body.mode, pool=body.pool)


@router.get(
    "/balance",
    response_model=GachaCurrencyBalanceRead,
    summary="Get Gacha Currency Balance",
)
async def gacha_balance(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await GachaService(db).get_balance(user)


@router.post(
    "/daily-claim",
    response_model=GachaDailyClaimResponse,
    summary="Claim Daily Gacha Currency",
    responses=error_responses(409, 429),
    dependencies=[
        Depends(
            rate_limit(
                max_requests=settings.gacha_daily_claim_rate_limit_requests,
                window_seconds=settings.gacha_daily_claim_rate_limit_window_seconds,
                scope="gacha_daily_claim",
            )
        )
    ],
)
async def claim_daily_gacha_currency(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await GachaService(db).claim_daily_currency(user)


@router.get(
    "/stats",
    response_model=GachaStatsResponse,
    summary="Get Gacha Stats",
)
async def gacha_stats(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await GachaService(db).stats(user)


@router.post(
    "/recalculate-rarity",
    response_model=RarityRecalculationResponse,
    summary="Recalculate Gacha Rarity",
    responses={**ADMIN_ERROR_RESPONSES, **error_responses(409)},
)
async def recalculate_rarity(
    _: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await GachaService(db).recalculate_rarity()
