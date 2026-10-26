import asyncio
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import Response
from jose import jwt
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from backend.app.config import settings
from backend.app.models.auth import AuthExchange, User
from backend.app.routers import auth
from backend.app.services.owner_auth import (
    auth_fingerprint,
    validate_auth_configuration,
)
from backend.app.utils.passwords import hash_token


async def setup(client):
    result = await client.post(
        "/api/v1/auth/setup",
        json={
            "username": "owner",
            "password": "a-password-123",
            "setup_token": "test-owner-setup",
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


def bearer(tokens):
    return {"Authorization": "Bearer " + tokens["access_token"]}


@pytest.mark.asyncio
async def test_setup_singleton_sessions_and_configuration_change(
    owner_client, monkeypatch
):
    client, maker = owner_client
    assert (await client.get("/api/v1/me")).status_code == 401
    bad = await client.post(
        "/api/v1/auth/setup",
        json={
            "username": "owner",
            "password": "a-password-123",
            "setup_token": "wrong",
        },
    )
    assert bad.status_code == 403
    body = {
        "username": "owner",
        "password": "a-password-123",
        "setup_token": "test-owner-setup",
    }
    attempts = await asyncio.gather(
        client.post("/api/v1/auth/setup", json=body),
        client.post("/api/v1/auth/setup", json=body),
    )
    assert sorted(r.status_code for r in attempts) == [200, 409]
    tokens = next(r.json() for r in attempts if r.status_code == 200)
    assert (await client.get("/api/v1/me", headers=bearer(tokens))).status_code == 200
    assert (await client.get("/docs")).status_code == 200
    refreshed = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert refreshed.status_code == 200
    assert (
        await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
    ).status_code == 401
    tokens = refreshed.json()
    await client.post(
        "/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]}
    )
    assert (await client.get("/api/v1/me", headers=bearer(tokens))).status_code == 401
    tokens = (
        await client.post(
            "/api/v1/auth/login",
            data={"username": "OWNER", "password": "a-password-123"},
        )
    ).json()
    monkeypatch.setattr(settings, "auth_mode", "oidc")
    assert (await client.get("/api/v1/me", headers=bearer(tokens))).status_code == 401
    assert (
        await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
    ).status_code == 401
    assert (
        await client.post(
            "/api/v1/auth/login",
            data={"username": "owner", "password": "a-password-123"},
        )
    ).status_code == 403
    async with maker() as db:
        db.add(
            User(username="second", email="second@test.test", hashed_password="hash")
        )
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_owner_preferences_api_keys_and_removed_routes(owner_client, monkeypatch):
    client, _ = owner_client
    tokens = await setup(client)
    headers = bearer(tokens)
    profile = (await client.get("/api/v1/me", headers=headers)).json()
    assert not {"is_admin", "storage_quota_mb"}.intersection(profile)
    result = await client.patch(
        "/api/v1/me",
        headers=headers,
        json={"show_nsfw": False, "version": profile["version"]},
    )
    assert result.status_code == 200 and result.json()["show_nsfw"] is False
    key = (await client.post("/api/v1/me/api-key", headers=headers)).json()["api_key"]
    monkeypatch.setattr(settings, "auth_mode", "oidc")
    key_headers = {"Authorization": "Bearer " + key}
    assert (await client.get("/api/v1/me", headers=key_headers)).status_code == 200
    assert (
        await client.patch(
            "/api/v1/me", headers=key_headers, json={"password": "new-password"}
        )
    ).status_code == 403
    for path in [
        "/api/v1/admin/users",
        "/api/v1/gacha",
        "/api/v1/collection",
        "/api/v1/trades",
        "/api/v1/media/" + str(uuid.uuid4()) + "/embed",
        "/api/v1/media/" + str(uuid.uuid4()) + "/preview-image",
    ]:
        assert (await client.get(path, headers=key_headers)).status_code == 404
    assert (
        await client.post(
            "/api/v1/auth/register",
            json={
                "username": "another",
                "password": "password123",
                "email": "a@b.test",
            },
        )
    ).status_code == 404


@pytest.mark.asyncio
async def test_legacy_access_token_rejected(owner_client):
    client, _ = owner_client
    await setup(client)
    old = jwt.encode(
        {"sub": str(uuid.uuid4()), "exp": datetime.now(UTC) + timedelta(minutes=1)},
        settings.secret_key,
        algorithm="HS256",
    )
    assert (
        await client.get("/api/v1/me", headers={"Authorization": "Bearer " + old})
    ).status_code == 401


@pytest.mark.parametrize(
    "return_url", ["//evil.test", "https://evil.test", "/\\evil.test", "/\nevil.test"]
)
def test_return_url_cannot_escape_application(return_url):
    assert auth.internal_return_url(return_url) == "/"


@pytest.mark.parametrize("mode", ["bad", "oidc"])
def test_missing_authentication_configuration_fails_closed(monkeypatch, mode):
    monkeypatch.setattr(settings, "auth_mode", mode)
    monkeypatch.setattr(settings, "oidc_client_secret", "")
    with pytest.raises(RuntimeError):
        validate_auth_configuration()


@pytest.mark.asyncio
async def test_exchange_is_browser_bound_single_use_and_expires(
    owner_client, monkeypatch
):
    client, maker = owner_client
    await setup(client)
    monkeypatch.setattr(settings, "auth_mode", "oidc")
    monkeypatch.setattr(auth, "oidc_client", lambda: object())
    browser = secrets.token_urlsafe(32)
    code = secrets.token_urlsafe(32)
    async with maker() as db:
        db.add(
            AuthExchange(
                code_hash=hash_token(code),
                browser_hash=hash_token(browser),
                auth_config=auth_fingerprint(),
                expires_at=datetime.now(UTC) + timedelta(seconds=60),
            )
        )
        await db.commit()
    assert (
        await client.post("/api/v1/auth/oidc/exchange", json={"code": code})
    ).status_code == 401
    client.cookies.set("zukan_oidc_browser", browser, path="/api/v1/auth")
    result = await client.post("/api/v1/auth/oidc/exchange", json={"code": code})
    assert result.status_code == 200
    client.cookies.set("zukan_oidc_browser", browser, path="/api/v1/auth")
    assert (
        await client.post("/api/v1/auth/oidc/exchange", json={"code": code})
    ).status_code == 401
    async with maker() as db:
        db.add(
            AuthExchange(
                code_hash=hash_token(code),
                browser_hash=hash_token(browser),
                auth_config=auth_fingerprint(),
                expires_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        )
        await db.commit()
    assert (
        await client.post("/api/v1/auth/oidc/exchange", json={"code": code})
    ).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "claims",
    [
        {"iss": "https://wrong", "sub": "owner"},
        {"iss": "https://issuer", "sub": "wrong"},
    ],
)
async def test_oidc_callback_rejects_wrong_identity(owner_client, monkeypatch, claims):
    _, maker = owner_client
    monkeypatch.setattr(settings, "auth_mode", "oidc")
    monkeypatch.setattr(settings, "oidc_issuer", "https://issuer")
    monkeypatch.setattr(settings, "oidc_allowed_subject", "owner")
    monkeypatch.setattr(
        auth,
        "oidc_client",
        lambda: SimpleNamespace(
            authorize_access_token=AsyncMock(return_value={"userinfo": claims})
        ),
    )
    request = SimpleNamespace(
        cookies={"zukan_oidc_browser": "browser"},
        session={"owner_browser": "browser", "owner_auth": auth_fingerprint()},
    )
    async with maker() as db:
        with pytest.raises(auth.HTTPException) as error:
            await auth.oidc_callback(request, db)
        assert error.value.status_code == 401
        assert await db.scalar(select(AuthExchange)) is None
