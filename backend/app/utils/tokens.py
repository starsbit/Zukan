from __future__ import annotations
import uuid
from datetime import UTC, datetime, timedelta
from jose import JWTError, jwt
from backend.app.config import settings
from backend.app.services.owner_auth import auth_fingerprint

ALGORITHM = "HS256"


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> str:
    return jwt.encode(
        {
            "sub": str(user_id),
            "sid": str(session_id),
            "auth": auth_fingerprint(),
            "exp": datetime.now(UTC)
            + timedelta(minutes=settings.access_token_expire_minutes),
        },
        settings.secret_key,
        algorithm=ALGORITHM,
    )


def decode_access_claims(token: str) -> dict | None:
    try:
        claims = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        uuid.UUID(claims["sub"])
        uuid.UUID(claims["sid"])
        if claims.get("auth") != auth_fingerprint():
            return None
        return claims
    except (JWTError, KeyError, ValueError, TypeError):
        return None


def decode_access_token(token: str) -> uuid.UUID | None:
    claims = decode_access_claims(token)
    return uuid.UUID(claims["sub"]) if claims else None
