from fastapi import APIRouter, Depends, Form, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.config import settings
from backend.app.schemas import (
    ERROR_RESPONSES,
    RefreshTokenRequest,
    TokenResponse,
    UserPublicRead,
    UserRegister,
)
from backend.app.services.auth import AuthService
from backend.app.utils.rate_limit import rate_limit

router = APIRouter(prefix="/auth", tags=["auth"], responses=ERROR_RESPONSES)


@router.post(
    "/register",
    response_model=UserPublicRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register User",
    description="Create a new end-user account. Registration is rate limited by client IP.",
    responses={
        201: {
            "description": "User account created.",
            "content": {
                "application/json": {
                    "example": {
                        "id": "fe1db6af-8f07-4b07-85cd-5676d7f7aa19",
                        "username": "saber",
                        "email": "saber@starsbit.space",
                        "show_nsfw": False,
                        "tag_confidence_threshold": 0.35,
                        "version": 1,
                        "created_at": "2026-03-23T12:34:56Z",
                    }
                }
            },
        }
    },
    dependencies=[
        Depends(
            rate_limit(
                max_requests=settings.auth_register_rate_limit_requests,
                window_seconds=settings.auth_register_rate_limit_window_seconds,
                scope="auth_register",
            )
        )
    ],
)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
    return await AuthService(db).register_user(body)


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login",
    description="Authenticate with username/password and receive access + refresh tokens.",
    responses={
        200: {
            "description": "Tokens issued.",
            "content": {
                "application/json": {
                    "example": {
                        "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                        "refresh_token": "VwqXgY1VxM0h7SmpQn8r9A...",
                        "token_type": "bearer",
                    }
                }
            },
        }
    },
    openapi_extra={
        "requestBody": {
            "content": {
                "application/x-www-form-urlencoded": {
                    "example": {
                        "username": "asuka",
                        "password": "super-secret-passphrase",
                        "remember_me": False,
                    }
                }
            }
        }
    },
    dependencies=[
        Depends(
            rate_limit(
                max_requests=settings.auth_login_rate_limit_requests,
                window_seconds=settings.auth_login_rate_limit_window_seconds,
                scope="auth_login",
            )
        )
    ],
)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    remember_me: bool = Form(False),
    db: AsyncSession = Depends(get_db),
):
    return await AuthService(db).login_user(
        form_data.username,
        form_data.password,
        remember_me,
    )


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Refresh Access Token",
    description="Exchange a valid refresh token for a fresh access token and rotated refresh token.",
    responses={
        200: {
            "description": "Token pair refreshed.",
            "content": {
                "application/json": {
                    "example": {
                        "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                        "refresh_token": "QkNfR4IuZfW6gN3xN8u8mA...",
                        "token_type": "bearer",
                    }
                }
            },
        }
    },
    dependencies=[
        Depends(
            rate_limit(
                max_requests=settings.auth_refresh_rate_limit_requests,
                window_seconds=settings.auth_refresh_rate_limit_window_seconds,
                scope="auth_refresh",
            )
        )
    ],
)
async def refresh(body: RefreshTokenRequest, db: AsyncSession = Depends(get_db)):
    return await AuthService(db).refresh_access_token(body.refresh_token)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Logout",
    description="Revoke a refresh token. Safe to repeat.",
    responses={204: {"description": "Refresh token revoked or already invalid."}},
)
async def logout(body: RefreshTokenRequest, db: AsyncSession = Depends(get_db)):
    await AuthService(db).revoke_refresh_token(body.refresh_token)
