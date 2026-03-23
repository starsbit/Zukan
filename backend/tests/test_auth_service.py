import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from jose import jwt
from sqlalchemy import select

from backend.app.models.auth import User
from backend.app.models.auth import RefreshToken
from backend.app.services.auth import (
    ALGORITHM,
    _hash_token,
    _refresh_token_expiry_days,
    create_access_token,
    decode_access_token,
    login_user,
    refresh_access_token,
    register_user,
    revoke_refresh_token,
    rotate_refresh_token,
    hash_password,
    update_current_user,
    verify_password,
)
from backend.app.config import settings
from backend.app.schemas import UserLogin, UserRegister, UserUpdate


def test_hash_password_produces_bcrypt_hash():
    h = hash_password("mysecret")
    assert h.startswith("$2b$")


def test_hash_password_unique_per_call():
    assert hash_password("same") != hash_password("same")


def test_verify_password_correct():
    h = hash_password("correct")
    assert verify_password("correct", h) is True


def test_verify_password_wrong():
    h = hash_password("correct")
    assert verify_password("wrong", h) is False


def test_create_access_token_is_valid_jwt():
    uid = uuid.uuid4()
    token = create_access_token(uid)
    payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    assert payload["sub"] == str(uid)


def test_create_access_token_expires_in_future():
    uid = uuid.uuid4()
    token = create_access_token(uid)
    payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    assert payload["exp"] > datetime.now(UTC).timestamp()


def test_decode_access_token_returns_uuid():
    uid = uuid.uuid4()
    token = create_access_token(uid)
    assert decode_access_token(token) == uid


def test_decode_access_token_invalid_returns_none():
    assert decode_access_token("notavalidtoken") is None


def test_decode_access_token_wrong_key_returns_none():
    uid = uuid.uuid4()
    token = jwt.encode({"sub": str(uid), "exp": datetime.now(UTC) + timedelta(minutes=15)}, "wrongkey", algorithm=ALGORITHM)
    assert decode_access_token(token) is None


def test_decode_access_token_expired_returns_none():
    uid = uuid.uuid4()
    token = jwt.encode({"sub": str(uid), "exp": datetime.now(UTC) - timedelta(seconds=1)}, settings.secret_key, algorithm=ALGORITHM)
    assert decode_access_token(token) is None


def test_register_user_creates_account(api):
    async def _exercise(session):
        user = await register_user(
            session,
            UserRegister(username="service-auth-user", email="service-auth@example.com", password="password123"),
        )
        assert user.username == "service-auth-user"
        assert user.email == "service-auth@example.com"
        assert user.hashed_password != "password123"
        assert user.tag_confidence_threshold == settings.tagger_threshold_general

    api.run_db(_exercise)


def test_register_user_rejects_duplicate_username_and_email(api):
    api.register_and_login("service-auth-duplicate", email="service-auth-duplicate@example.com")

    async def _duplicate_username(session):
        await register_user(
            session,
            UserRegister(
                username="service-auth-duplicate",
                email="other@example.com",
                password="password123",
            ),
        )

    async def _duplicate_email(session):
        await register_user(
            session,
            UserRegister(
                username="service-auth-other",
                email="service-auth-duplicate@example.com",
                password="password123",
            ),
        )

    with pytest.raises(HTTPException) as username_exc:
        api.run_db(_duplicate_username)
    assert username_exc.value.status_code == 400

    with pytest.raises(HTTPException) as email_exc:
        api.run_db(_duplicate_email)
    assert email_exc.value.status_code == 400


def test_login_user_returns_tokens_and_rejects_bad_password(api):
    created = api.register_and_login("service-auth-login")
    user_id = uuid.UUID(created["user"]["id"])

    async def _valid(session):
        tokens = await login_user(session, UserLogin(username="service-auth-login", password="password123"))
        assert decode_access_token(tokens.access_token) == user_id
        assert tokens.refresh_token

    async def _invalid(session):
        await login_user(session, UserLogin(username="service-auth-login", password="wrongpass123"))

    api.run_db(_valid)

    with pytest.raises(HTTPException) as exc:
        api.run_db(_invalid)
    assert exc.value.status_code == 401


def test_login_user_remember_me_sets_long_lived_refresh_session(api):
    created = api.register_and_login("service-auth-remember")
    user_id = uuid.UUID(created["user"]["id"])

    async def _exercise(session):
        before = datetime.now(UTC)
        tokens = await login_user(
            session,
            UserLogin(username="service-auth-remember", password="password123", remember_me=True),
        )
        after = datetime.now(UTC)

        result = await session.execute(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(tokens.refresh_token)))
        record = result.scalar_one()

        assert decode_access_token(tokens.access_token) == user_id
        assert record.remember_me is True

        lower_bound = before + timedelta(days=_refresh_token_expiry_days(True)) - timedelta(seconds=1)
        upper_bound = after + timedelta(days=_refresh_token_expiry_days(True)) + timedelta(seconds=1)
        expires_at = record.expires_at.replace(tzinfo=UTC)
        assert lower_bound <= expires_at <= upper_bound

    api.run_db(_exercise)


def test_refresh_and_revoke_refresh_token_flow(api):
    created = api.register_and_login("service-auth-refresh")
    original_refresh = created["refresh_token"]

    async def _exercise(session):
        refreshed = await refresh_access_token(session, original_refresh)
        assert decode_access_token(refreshed.access_token) == uuid.UUID(created["user"]["id"])
        assert refreshed.refresh_token

        second_refresh = await refresh_access_token(session, refreshed.refresh_token)
        assert decode_access_token(second_refresh.access_token) == uuid.UUID(created["user"]["id"])
        assert second_refresh.refresh_token

        rotated = await rotate_refresh_token(session, original_refresh)
        assert rotated is None

        revoked = await revoke_refresh_token(session, "not-a-real-token")
        assert revoked is False

    api.run_db(_exercise)


def test_refresh_rotation_preserves_remember_me_duration(api):
    created = api.register_and_login("service-auth-refresh-remember", remember_me=True)

    async def _exercise(session):
        before = datetime.now(UTC)
        refreshed = await refresh_access_token(session, created["refresh_token"])
        after = datetime.now(UTC)

        result = await session.execute(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(refreshed.refresh_token)))
        record = result.scalar_one()

        assert record.remember_me is True
        lower_bound = before + timedelta(days=_refresh_token_expiry_days(True)) - timedelta(seconds=1)
        upper_bound = after + timedelta(days=_refresh_token_expiry_days(True)) + timedelta(seconds=1)
        expires_at = record.expires_at.replace(tzinfo=UTC)
        assert lower_bound <= expires_at <= upper_bound

    api.run_db(_exercise)


def test_update_current_user_changes_password_and_nsfw_setting(api):
    created = api.register_and_login("service-auth-update")
    user_id = uuid.UUID(created["user"]["id"])

    async def _exercise(session):
        user = await session.get(User, user_id)
        old_hash = user.hashed_password
        updated = await update_current_user(
            session,
            user,
            UserUpdate(show_nsfw=True, tag_confidence_threshold=0.72, password="newpassword123"),
        )
        assert updated.show_nsfw is True
        assert updated.tag_confidence_threshold == 0.72
        assert updated.hashed_password != old_hash
        assert verify_password("newpassword123", updated.hashed_password) is True

    api.run_db(_exercise)
