from __future__ import annotations

import hashlib

import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
