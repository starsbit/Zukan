from fastapi import APIRouter, Depends, Form, status, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.database import get_db
from backend.app.config import settings
from backend.app.schemas import RefreshTokenRequest, TokenResponse, error_responses
from backend.app.services.auth import AuthService
from backend.app.utils.rate_limit import rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])


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
        },
        **error_responses(401, 422, 429),
    },
    openapi_extra={
        "requestBody": {
            "content": {
                "application/x-www-form-urlencoded": {
                    "example": {
                        "username": "saber",
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
    response: Response = None,
    db: AsyncSession = Depends(get_db),
):
    tokens = await AuthService(db).login_user(
        form_data.username, form_data.password, remember_me
    )
    docs_cookie(response, tokens)
    return tokens


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
        },
        **error_responses(401, 422, 429),
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
async def refresh(
    body: RefreshTokenRequest, response: Response, db: AsyncSession = Depends(get_db)
):
    tokens = await AuthService(db).refresh_access_token(body.refresh_token)
    docs_cookie(response, tokens)
    return tokens


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Logout",
    description="Revoke a refresh token. Safe to repeat.",
    responses={
        204: {"description": "Refresh token revoked or already invalid."},
        **error_responses(422),
    },
)
async def logout(
    body: RefreshTokenRequest, response: Response, db: AsyncSession = Depends(get_db)
):
    await AuthService(db).revoke_refresh_token(body.refresh_token)
    response.delete_cookie("zukan_docs")


import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlsplit
from fastapi import HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from authlib.integrations.starlette_client import OAuth
from backend.app.models.auth import AuthExchange, User
from backend.app.services.owner_auth import auth_fingerprint
from backend.app.utils.passwords import hash_password, hash_token

oauth = OAuth()


def oidc_client():
    if settings.auth_mode != "oidc":
        raise HTTPException(404, "OIDC is disabled")
    if not oauth.create_client("owner"):
        oauth.register(
            "owner",
            client_id=settings.oidc_client_id,
            client_secret=settings.oidc_client_secret,
            server_metadata_url=settings.oidc_discovery_url,
            client_kwargs={"scope": "openid profile", "code_challenge_method": "S256"},
        )
    return oauth.create_client("owner")


def internal_return_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        not value.startswith("/")
        or value.startswith("//")
        or parsed.scheme
        or parsed.netloc
        or ("\\" in value)
        or any((ord(c) < 32 for c in value))
    ):
        return "/"
    return value


def docs_cookie(response: Response, tokens: TokenResponse):
    response.set_cookie(
        "zukan_docs",
        tokens.access_token
        if isinstance(tokens, TokenResponse)
        else tokens["access_token"],
        httponly=True,
        secure=settings.auth_mode == "oidc"
        and settings.oidc_callback_url.startswith("https:"),
        samesite="strict",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )


class OwnerSetup(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8)
    setup_token: str


class ExchangeRequest(BaseModel):
    code: str = Field(min_length=32, max_length=128)


@router.get("/config")
async def authentication_config(db: AsyncSession = Depends(get_db)):
    return {
        "mode": settings.auth_mode,
        "setup_required": settings.auth_mode == "local"
        and await db.scalar(select(User.id)) is None,
    }


@router.post(
    "/setup",
    response_model=TokenResponse,
    dependencies=[
        Depends(rate_limit(max_requests=5, window_seconds=60, scope="owner_setup"))
    ],
)
async def setup(
    body: OwnerSetup, response: Response, db: AsyncSession = Depends(get_db)
):
    if (
        settings.auth_mode != "local"
        or not settings.setup_token
        or (
            not secrets.compare_digest(
                body.setup_token.encode(), settings.setup_token.encode()
            )
        )
    ):
        raise HTTPException(403, "Invalid setup token or setup disabled")
    await db.execute(text("SELECT pg_advisory_xact_lock(1515544911)"))
    if await db.scalar(select(User.id)) is not None:
        raise HTTPException(409, "Owner already configured")
    user = User(
        username=body.username,
        email="owner@localhost",
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()
    tokens = await AuthService(db).issue_session(user)
    docs_cookie(response, tokens)
    return tokens


@router.get("/oidc/start")
async def oidc_start(request: Request, return_url: str = "/"):
    client = oidc_client()
    browser = secrets.token_urlsafe(32)
    request.session["owner_browser"] = browser
    request.session["owner_return"] = internal_return_url(return_url)
    request.session["owner_auth"] = auth_fingerprint()
    response = await client.authorize_redirect(request, settings.oidc_callback_url)
    response.set_cookie(
        "zukan_oidc_browser",
        browser,
        httponly=True,
        secure=settings.oidc_callback_url.startswith("https:"),
        samesite="lax",
        max_age=600,
        path="/api/v1/auth",
    )
    return response


@router.get("/oidc/callback")
async def oidc_callback(request: Request, db: AsyncSession = Depends(get_db)):
    client = oidc_client()
    browser = request.cookies.get("zukan_oidc_browser", "")
    if (
        not browser
        or not secrets.compare_digest(browser, request.session.get("owner_browser", ""))
        or request.session.get("owner_auth") != auth_fingerprint()
    ):
        raise HTTPException(401, "Invalid login session")
    try:
        token = await client.authorize_access_token(request)
        claims = token["userinfo"]
        if (
            claims.get("iss") != settings.oidc_issuer
            or claims.get("sub") != settings.oidc_allowed_subject
        ):
            raise ValueError("Identity does not match installation owner")
    except Exception:
        request.session.clear()
        raise HTTPException(401, "SSO authentication failed") from None
    code = secrets.token_urlsafe(32)
    db.add(
        AuthExchange(
            code_hash=hash_token(code),
            browser_hash=hash_token(browser),
            auth_config=auth_fingerprint(),
            expires_at=datetime.now(UTC) + timedelta(seconds=60),
        )
    )
    await db.commit()
    destination = internal_return_url(request.session.get("owner_return", "/"))
    request.session.clear()
    return RedirectResponse(
        "/login?" + urlencode({"code": code, "returnUrl": destination}),
        status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


@router.post("/oidc/exchange", response_model=TokenResponse)
async def exchange(
    body: ExchangeRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    oidc_client()
    record = await db.scalar(
        select(AuthExchange)
        .where(AuthExchange.code_hash == hash_token(body.code))
        .with_for_update()
    )
    browser = request.cookies.get("zukan_oidc_browser", "")
    if (
        record is None
        or record.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC)
        or record.auth_config != auth_fingerprint()
        or (not browser)
        or (not secrets.compare_digest(record.browser_hash, hash_token(browser)))
    ):
        raise HTTPException(401, "Invalid or expired login exchange")
    user = await db.scalar(select(User))
    if user is None:
        raise HTTPException(503, "Owner is not initialized")
    await db.delete(record)
    tokens = await AuthService(db).issue_session(user)
    response.delete_cookie("zukan_oidc_browser", path="/api/v1/auth")
    docs_cookie(response, tokens)
    response.headers["Cache-Control"] = "no-store"
    return tokens
