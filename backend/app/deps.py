from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials, OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.models import User
from backend.app.services.auth import authenticate_basic_user, decode_access_token, get_user_by_id

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login-form", auto_error=False)
basic_scheme = HTTPBasic(auto_error=False)


async def current_user(
    token: str | None = Depends(oauth2_scheme),
    credentials: HTTPBasicCredentials | None = Depends(basic_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if token is not None:
        user_id = decode_access_token(token)
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user = await get_user_by_id(db, user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user

    if credentials is not None:
        user = await authenticate_basic_user(db, credentials.username, credentials.password)
        if user is not None:
            return user
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid basic credentials")

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


async def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user
