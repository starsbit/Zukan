"""Exercise the OIDC library's actual validation with signed tokens, without a network IdP."""

import time
from types import SimpleNamespace
from urllib.parse import urlsplit, parse_qs
from unittest.mock import AsyncMock
import pytest
from authlib.integrations.starlette_client import OAuth
from joserfc import jwt
from joserfc.jwk import RSAKey
from backend.app.routers import auth


@pytest.fixture
def provider():
    key = RSAKey.generate_key(2048, parameters={"kid": "test-key"})
    client = OAuth().register(
        "test",
        client_id="zukan",
        client_secret="secret",
        authorize_url="https://issuer/authorize",
        access_token_url="https://issuer/token",
        client_kwargs={"scope": "openid profile", "code_challenge_method": "S256"},
        issuer="https://issuer",
        jwks={"keys": [key.as_dict(private=False)]},
        id_token_signing_alg_values_supported=["RS256"],
    )
    return client, key


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invalid", ["audience", "issuer", "expiry", "nonce", "signature"]
)
async def test_oidc_rejects_invalid_signed_id_tokens(provider, invalid):
    client, key = provider
    claims = {
        "iss": "https://issuer",
        "sub": "owner",
        "aud": "zukan",
        "exp": int(time.time()) + 60,
        "iat": int(time.time()),
        "nonce": "nonce",
    }
    if invalid == "audience":
        claims["aud"] = "other-app"
    if invalid == "issuer":
        claims["iss"] = "https://wrong"
    if invalid == "expiry":
        claims["exp"] = int(time.time()) - 300
    if invalid == "nonce":
        claims["nonce"] = "wrong"
    signing_key = (
        RSAKey.generate_key(2048, parameters={"kid": "test-key"})
        if invalid == "signature"
        else key
    )
    token = jwt.encode({"alg": "RS256", "kid": "test-key"}, claims, signing_key)
    with pytest.raises(Exception):
        await client.parse_id_token(
            {"id_token": token, "access_token": "access"}, nonce="nonce", leeway=0
        )


@pytest.mark.asyncio
async def test_authorization_uses_pkce_nonce_and_state(provider):
    client, _ = provider
    request = SimpleNamespace(session={})
    result = await client.authorize_redirect(
        request, "https://zukan/api/v1/auth/oidc/callback"
    )
    params = parse_qs(urlsplit(result.headers["location"]).query)
    assert params["code_challenge_method"] == ["S256"]
    assert params["code_challenge"] and params["nonce"] and params["state"]
    request.scope = {"method": "GET"}
    request.query_params = {"state": "wrong", "code": "code"}
    client.fetch_access_token = AsyncMock()
    with pytest.raises(Exception):
        await client.authorize_access_token(request)
    client.fetch_access_token.assert_not_awaited()


def callback_request(session, browser="browser", **query):
    return SimpleNamespace(
        session=session,
        cookies={"zukan_oidc_browser": browser},
        scope={"method": "GET"},
        query_params=query,
    )


@pytest.mark.asyncio
async def test_start_lets_provider_show_login_and_keeps_destination(
    provider, monkeypatch
):
    client, _ = provider
    monkeypatch.setattr(auth, "oidc_client", lambda: client)
    request = SimpleNamespace(session={})
    response = await auth.oidc_start(request, "/album/1")
    params = parse_qs(urlsplit(response.headers["location"]).query)
    assert "prompt" not in params
    assert request.session["owner_return"] == "/album/1"


@pytest.mark.asyncio
async def test_provider_rejection_returns_to_login_with_destination(
    provider, monkeypatch
):
    client, _ = provider
    monkeypatch.setattr(auth, "oidc_client", lambda: client)
    monkeypatch.setattr(auth, "auth_fingerprint", lambda: "fingerprint")
    session = {
        "owner_browser": "browser",
        "owner_auth": "fingerprint",
        "owner_return": "/album/1",
    }
    response = await auth.oidc_callback(
        callback_request(session, error="access_denied", state="state"), db=None
    )
    assert response.status_code == 303
    params = parse_qs(urlsplit(response.headers["location"]).query)
    assert params == {"sso": ["failed"], "returnUrl": ["/album/1"]}
    assert session == {}


@pytest.mark.asyncio
async def test_callback_without_login_session_returns_to_login(provider, monkeypatch):
    client, _ = provider
    monkeypatch.setattr(auth, "oidc_client", lambda: client)
    response = await auth.oidc_callback(callback_request({}), db=None)
    params = parse_qs(urlsplit(response.headers["location"]).query)
    assert params == {"sso": ["failed"], "returnUrl": ["/"]}
