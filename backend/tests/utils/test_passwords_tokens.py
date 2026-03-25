from __future__ import annotations

import uuid

from backend.app.utils.passwords import hash_password, hash_token, verify_password
from backend.app.utils.tokens import create_access_token, decode_access_token


def test_password_hash_and_verify_roundtrip():
    hashed = hash_password("secret123")
    assert hashed != "secret123"
    assert verify_password("secret123", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_hash_token_is_stable_sha256():
    assert hash_token("abc") == hash_token("abc")
    assert hash_token("abc") != hash_token("abcd")


def test_access_token_encode_decode_roundtrip():
    user_id = uuid.uuid4()
    token = create_access_token(user_id)
    assert decode_access_token(token) == user_id
    assert decode_access_token("invalid") is None
