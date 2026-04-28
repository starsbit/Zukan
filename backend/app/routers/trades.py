import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.models.auth import User
from backend.app.routers.deps import current_user
from backend.app.schemas import AUTHENTICATED_ERROR_RESPONSES, error_responses
from backend.app.schemas.trade import TradeCreateRequest, TradeListResponse, TradeOfferRead
from backend.app.services.trade import TradeService

router = APIRouter(prefix="/trades", tags=["trades"], responses=AUTHENTICATED_ERROR_RESPONSES)


@router.post(
    "",
    response_model=TradeOfferRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create Trade Offer",
    responses=error_responses(403, 404, 409, 422),
)
async def create_trade(
    body: TradeCreateRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await TradeService(db).create_trade(user, body)


@router.get("/incoming", response_model=TradeListResponse, summary="List Incoming Trade Offers")
async def incoming_trades(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    items = await TradeService(db).list_incoming(user)
    return TradeListResponse(total=len(items), items=items)


@router.get("/outgoing", response_model=TradeListResponse, summary="List Outgoing Trade Offers")
async def outgoing_trades(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    items = await TradeService(db).list_outgoing(user)
    return TradeListResponse(total=len(items), items=items)


@router.post(
    "/{trade_id}/accept",
    response_model=TradeOfferRead,
    summary="Accept Trade Offer",
    responses=error_responses(403, 404, 409),
)
async def accept_trade(
    trade_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await TradeService(db).accept_trade(trade_id, user)


@router.post(
    "/{trade_id}/reject",
    response_model=TradeOfferRead,
    summary="Reject Trade Offer",
    responses=error_responses(403, 404, 409),
)
async def reject_trade(
    trade_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await TradeService(db).reject_trade(trade_id, user)


@router.post(
    "/{trade_id}/cancel",
    response_model=TradeOfferRead,
    summary="Cancel Trade Offer",
    responses=error_responses(403, 404, 409),
)
async def cancel_trade(
    trade_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await TradeService(db).cancel_trade(trade_id, user)
