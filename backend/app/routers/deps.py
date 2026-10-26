import uuid
from datetime import UTC, datetime
from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.database import get_db
from backend.app.errors.error import AppError
from backend.app.models.auth import AuthSession, User
from backend.app.services.auth import AuthService
from backend.app.utils.tokens import decode_access_claims

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def current_user(
    token: str | None = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)
) -> User:
    service = AuthService(db)
    if token:
        claims = decode_access_claims(token)
        if claims:
            session = await db.get(AuthSession, uuid.UUID(claims["sid"]))
            if (
                session
                and (not session.revoked)
                and (session.expires_at.replace(tzinfo=UTC) > datetime.now(UTC))
            ):
                user = await service.get_user_by_id(uuid.UUID(claims["sub"]))
                if user:
                    return user
        if token.startswith("zk_"):
            user = await service.get_user_by_api_key(token)
            if user:
                return user
    raise AppError(
        status_code=401, code="not_authenticated", detail="Not authenticated"
    )


admin_user = current_user


async def docs_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    return await current_user(token or request.cookies.get("zukan_docs"), db)
