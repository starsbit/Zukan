from fastapi import Depends, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.errors import AppError, admin_required, invalid_token, not_authenticated, user_not_found
from backend.app.models.auth import User
from backend.app.services.auth import decode_access_token, get_user_by_id

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if token is not None:
        user_id = decode_access_token(token)
        if user_id is None:
            raise AppError(status_code=status.HTTP_401_UNAUTHORIZED, code=invalid_token, detail="Invalid token")
        user = await get_user_by_id(db, user_id)
        if user is None:
            raise AppError(status_code=status.HTTP_401_UNAUTHORIZED, code=user_not_found, detail="User not found")
        return user
    raise AppError(status_code=status.HTTP_401_UNAUTHORIZED, code=not_authenticated, detail="Not authenticated")


async def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise AppError(status_code=status.HTTP_403_FORBIDDEN, code=admin_required, detail="Admin access required")
    return user
