from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.app.services.update_check import _check_for_updates, trigger_app_update


# ── helpers ──────────────────────────────────────────────────────────────────


def _make_github_response(tag: str = "1.2.3", html_url: str = "https://github.com/r/releases/1") -> dict:
    return {
        "tag_name": f"v{tag}",
        "html_url": html_url,
        "body": "Release notes here.",
    }


def _make_announcement(version: str = "1.2.3") -> MagicMock:
    ann = MagicMock()
    ann.id = uuid.uuid4()
    ann.version = version
    ann.title = f"Zukan {version} is available"
    ann.message = (
        f"Zukan {version} is available.\n"
        "You are running 1.0.0.\n"
        f"Full changelog: https://github.com/starsbit/zukan/compare/v1.0.0...v{version}"
    )
    ann.severity = MagicMock(value="info")
    ann.starts_at = None
    ann.ends_at = None
    return ann


# ── _check_for_updates ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_check_skips_dev_version():
    with patch("backend.app.services.update_check.settings") as mock_settings:
        mock_settings.app_version = "dev"

        with patch("backend.app.services.update_check.httpx.AsyncClient") as mock_client_cls:
            await _check_for_updates()
            mock_client_cls.assert_not_called()


@pytest.mark.asyncio
async def test_check_skips_invalid_version():
    with patch("backend.app.services.update_check.settings") as mock_settings:
        mock_settings.app_version = "not-a-version"

        with patch("backend.app.services.update_check.httpx.AsyncClient") as mock_client_cls:
            await _check_for_updates()
            mock_client_cls.assert_not_called()


@pytest.mark.asyncio
async def test_check_handles_github_network_error():
    with patch("backend.app.services.update_check.settings") as mock_settings:
        mock_settings.app_version = "1.0.0"

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPError("connection failed")
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.HTTPError("connection failed"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.app.services.update_check.httpx.AsyncClient", return_value=mock_client):
            with patch("backend.app.services.update_check.AsyncSessionLocal"):
                await _check_for_updates()  # should not raise


@pytest.mark.asyncio
async def test_check_skips_when_already_up_to_date():
    with patch("backend.app.services.update_check.settings") as mock_settings:
        mock_settings.app_version = "1.2.3"

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value=_make_github_response("1.2.3"))
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.app.services.update_check.httpx.AsyncClient", return_value=mock_client):
            with patch("backend.app.services.update_check.AsyncSessionLocal") as mock_session_cls:
                await _check_for_updates()
                mock_session_cls.assert_not_called()


@pytest.mark.asyncio
async def test_check_skips_when_announcement_already_exists():
    with patch("backend.app.services.update_check.settings") as mock_settings:
        mock_settings.app_version = "1.0.0"

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value=_make_github_response("1.2.3"))
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        mock_db = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.app.services.update_check.httpx.AsyncClient", return_value=mock_client):
            with patch("backend.app.services.update_check.AsyncSessionLocal", return_value=mock_db):
                with patch("backend.app.services.update_check.AppAnnouncementRepository") as repo_cls:
                    repo_cls.return_value.find_by_version = AsyncMock(return_value=_make_announcement("1.2.3"))

                    with patch("backend.app.services.update_check.NotificationService") as svc_cls:
                        await _check_for_updates()
                        svc_cls.return_value.publish_admin_notification.assert_not_called()


@pytest.mark.asyncio
async def test_check_creates_announcement_and_notifies_admins():
    with patch("backend.app.services.update_check.settings") as mock_settings:
        mock_settings.app_version = "1.0.0"

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value=_make_github_response("1.2.3", html_url="https://example.com"))
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda ann: setattr(ann, "id", uuid.uuid4()) or None)
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.app.services.update_check.httpx.AsyncClient", return_value=mock_client):
            with patch("backend.app.services.update_check.AsyncSessionLocal", return_value=mock_db):
                with patch("backend.app.services.update_check.AppAnnouncementRepository") as repo_cls:
                    repo_cls.return_value.find_by_version = AsyncMock(return_value=None)

                    with patch("backend.app.services.update_check.NotificationService") as svc_cls:
                        svc_cls.return_value.publish_admin_notification = AsyncMock(return_value=1)

                        await _check_for_updates()

                        svc_cls.return_value.publish_admin_notification.assert_awaited_once()
                        call_kwargs = svc_cls.return_value.publish_admin_notification.call_args.kwargs
                        assert "1.2.3" in call_kwargs["title"]
                        assert "Full changelog:" in call_kwargs["body"]
                        assert "compare/v1.0.0...v1.2.3" in call_kwargs["body"]
                        assert call_kwargs["data"]["version"] == "1.2.3"
                        assert call_kwargs["data"]["severity"] == "info"
                        assert "announcement_id" in call_kwargs["data"]
                        assert mock_db.add.called


# ── trigger_app_update ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_trigger_app_update_success():
    with patch("backend.app.services.update_check.settings") as mock_settings:
        mock_settings.updater_url = "http://updater:8080"
        mock_settings.updater_token = "secret"

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.app.services.update_check.httpx.AsyncClient", return_value=mock_client):
            await trigger_app_update()

        mock_client.post.assert_awaited_once_with(
            "http://updater:8080/update",
            headers={"Authorization": "Bearer secret"},
        )
        mock_response.raise_for_status.assert_called_once()


@pytest.mark.asyncio
async def test_trigger_app_update_raises_on_http_error():
    with patch("backend.app.services.update_check.settings") as mock_settings:
        mock_settings.updater_url = "http://updater:8080"
        mock_settings.updater_token = "secret"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=httpx.HTTPError("connection refused"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.app.services.update_check.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(httpx.HTTPError):
                await trigger_app_update()
