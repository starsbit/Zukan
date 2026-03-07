import uuid
from datetime import UTC, datetime, timedelta

import pytest
from jose import jwt

from app.services.auth import (
    ALGORITHM,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.config import settings


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
