"""Installation authentication configuration and bootstrap."""

import hashlib
import json
import uuid
from urllib.parse import urlsplit
from sqlalchemy import select
from backend.app.config import settings
from backend.app.database import AsyncSessionLocal
from backend.app.models.auth import User


def auth_fingerprint() -> str:
    values = [settings.auth_mode, settings.secret_key]
    if settings.auth_mode == "oidc":
        values += [
            settings.oidc_discovery_url,
            settings.oidc_issuer,
            settings.oidc_client_id,
            settings.oidc_client_secret,
            settings.oidc_callback_url,
            settings.oidc_allowed_subject,
        ]
    return hashlib.sha256(json.dumps(values).encode()).hexdigest()


def validate_auth_configuration() -> None:
    if settings.auth_mode not in {"local", "oidc"}:
        raise RuntimeError("AUTH_MODE must be local or oidc")
    if settings.auth_mode == "oidc":
        for field in (
            "discovery_url",
            "issuer",
            "client_id",
            "client_secret",
            "callback_url",
            "allowed_subject",
        ):
            if not getattr(settings, "oidc_" + field):
                raise RuntimeError("OIDC_" + field.upper() + " is required")
        for field in ("discovery_url", "issuer", "callback_url"):
            url = urlsplit(getattr(settings, "oidc_" + field))
            if (
                not url.hostname
                or url.username
                or url.password
                or url.fragment
                or (
                    url.scheme != "https"
                    and (
                        not (
                            url.scheme == "http"
                            and url.hostname in {"localhost", "127.0.0.1"}
                        )
                    )
                )
            ):
                raise RuntimeError(
                    "OIDC_"
                    + field.upper()
                    + " must be an HTTPS URL (HTTP allowed for localhost)"
                )


async def initialize_authentication() -> None:
    validate_auth_configuration()
    if settings.auth_mode == "oidc":
        from backend.app.routers.auth import oidc_client

        metadata = await oidc_client().load_server_metadata()
        if metadata.get("issuer") != settings.oidc_issuer or not all(
            metadata.get(k)
            for k in ("authorization_endpoint", "token_endpoint", "jwks_uri")
        ):
            raise RuntimeError(
                "OIDC discovery does not match the configured issuer or lacks required endpoints"
            )
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text

            await db.execute(text("SELECT pg_advisory_xact_lock(1515544911)"))
            if await db.scalar(select(User.id)) is None:
                db.add(
                    User(
                        id=uuid.uuid4(),
                        username="owner",
                        email="owner@localhost",
                        hashed_password="!oidc",
                    )
                )
                await db.commit()
