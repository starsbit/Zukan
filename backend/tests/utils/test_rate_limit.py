from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.app.errors.error import AppError
from backend.app.utils.rate_limit import _client_ip, rate_limit, RateLimitStore


@pytest.mark.asyncio
async def test_rate_limit_store_allows_within_limit_and_blocks_after():
    store = RateLimitStore()
    await store.check(key="k", max_requests=2, window_seconds=60)
    await store.check(key="k", max_requests=2, window_seconds=60)
    with pytest.raises(AppError) as exc:
        await store.check(key="k", max_requests=2, window_seconds=60)
    assert exc.value.status_code == 429


def test_client_ip_prefers_forwarded_header_then_client():
    req = SimpleNamespace(headers={"x-forwarded-for": "1.2.3.4, 5.6.7.8"}, client=SimpleNamespace(host="9.9.9.9"))
    assert _client_ip(req) == "1.2.3.4"
    req2 = SimpleNamespace(headers={}, client=SimpleNamespace(host="9.9.9.9"))
    assert _client_ip(req2) == "9.9.9.9"


@pytest.mark.asyncio
async def test_rate_limit_dependency_uses_store(monkeypatch):
    calls = []

    class _Store:
        async def check(self, **kwargs):
            calls.append(kwargs)

    from backend.app import utils as utils_pkg
    from backend.app.utils import rate_limit as rate_limit_module

    monkeypatch.setattr(rate_limit_module, "rate_limit_store", _Store())
    dep = rate_limit(max_requests=10, window_seconds=30, scope="auth")
    req = SimpleNamespace(headers={}, client=SimpleNamespace(host="1.1.1.1"))
    await dep(req)
    assert calls[0]["key"] == "auth:1.1.1.1"
