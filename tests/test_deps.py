import asyncio
import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPBasicCredentials

from app import deps


def test_current_user_returns_loaded_user(monkeypatch):
    user_id = uuid.uuid4()
    user = object()

    monkeypatch.setattr(deps, "decode_access_token", lambda token: user_id)
    monkeypatch.setattr(deps, "get_user_by_id", AsyncMock(return_value=user))

    result = asyncio.run(deps.current_user(token="token", db=object()))
    assert result is user


def test_current_user_rejects_invalid_token(monkeypatch):
    monkeypatch.setattr(deps, "decode_access_token", lambda token: None)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(deps.current_user(token="bad-token", db=object()))

    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


def test_current_user_rejects_missing_user(monkeypatch):
    monkeypatch.setattr(deps, "decode_access_token", lambda token: uuid.uuid4())
    monkeypatch.setattr(deps, "get_user_by_id", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(deps.current_user(token="token", db=object()))

    assert exc.value.status_code == 401
    assert exc.value.detail == "User not found"


def test_current_user_accepts_basic_auth(monkeypatch):
    user = object()
    monkeypatch.setattr(deps, "authenticate_basic_user", AsyncMock(return_value=user))

    result = asyncio.run(
        deps.current_user(
            token=None,
            credentials=HTTPBasicCredentials(username="docs-user", password="password123"),
            db=object(),
        )
    )

    assert result is user


def test_current_user_rejects_invalid_basic_auth(monkeypatch):
    monkeypatch.setattr(deps, "authenticate_basic_user", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            deps.current_user(
                token=None,
                credentials=HTTPBasicCredentials(username="docs-user", password="wrongpass123"),
                db=object(),
            )
        )

    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid basic credentials"


def test_current_user_rejects_missing_credentials():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(deps.current_user(token=None, credentials=None, db=object()))

    assert exc.value.status_code == 401
    assert exc.value.detail == "Not authenticated"


def test_admin_user_allows_admin_and_rejects_non_admin():
    admin = type("UserStub", (), {"is_admin": True})()
    regular = type("UserStub", (), {"is_admin": False})()

    assert asyncio.run(deps.admin_user(admin)) is admin

    with pytest.raises(HTTPException) as exc:
        asyncio.run(deps.admin_user(regular))

    assert exc.value.status_code == 403
    assert exc.value.detail == "Admin access required"
