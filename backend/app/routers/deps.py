from fastapi import Depends, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials, OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import AsyncSessionLocal, get_db
from backend.app.errors import AppError, admin_required, invalid_token, not_authenticated, user_not_found
from backend.app.models.auth import User
from backend.app.utils.tokens import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)
docs_basic = HTTPBasic()


async def current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if token is not None:
        user_id = decode_access_token(token)
        if user_id is None:
            raise AppError(status_code=status.HTTP_401_UNAUTHORIZED, code=invalid_token, detail="Invalid token")
        from backend.app.services.auth import AuthService
        user = await AuthService(db).get_user_by_id(user_id)
        if user is None:
            raise AppError(status_code=status.HTTP_401_UNAUTHORIZED, code=user_not_found, detail="User not found")
        return user
    raise AppError(status_code=status.HTTP_401_UNAUTHORIZED, code=not_authenticated, detail="Not authenticated")


async def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise AppError(status_code=status.HTTP_403_FORBIDDEN, code=admin_required, detail="Admin access required")
    return user


async def docs_user(credentials: HTTPBasicCredentials = Depends(docs_basic)) -> User:
    async with AsyncSessionLocal() as db:
        from backend.app.services.auth import AuthService
        user = await AuthService(db).authenticate_basic_user(credentials.username, credentials.password)
        if user is None:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized",
                headers={"WWW-Authenticate": "Basic"},
            )
        return user
