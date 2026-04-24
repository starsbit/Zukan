import asyncio
import logging

import httpx
from packaging.version import InvalidVersion, Version

from backend.app.config import settings
from backend.app.database import AsyncSessionLocal
from backend.app.models.notifications import AnnouncementSeverity, AppAnnouncement
from backend.app.repositories.notifications import AppAnnouncementRepository
from backend.app.services.notifications import NotificationService

logger = logging.getLogger(__name__)

_RELEASES_URL = "https://api.github.com/repos/starsbit/zukan/releases/latest"
_COMPARE_URL_TEMPLATE = "https://github.com/starsbit/zukan/compare/v{current}...v{latest}"


def _build_update_message(current_str: str, latest_str: str, release_notes: str = "") -> str:
    lines = [
        f"Zukan {latest_str} is available.",
        f"You are running {current_str}.",
        f"Full changelog: {_COMPARE_URL_TEMPLATE.format(current=current_str, latest=latest_str)}",
    ]
    if release_notes:
        lines.extend(["", release_notes.strip()])
    return "\n".join(lines).strip()


async def _ensure_update_notification(
    db,
    *,
    announcement: AppAnnouncement,
    version: str,
    html_url: str,
) -> int:
    return await NotificationService(db).publish_missing_admin_notification(
        title=announcement.title,
        body=announcement.message,
        link_url=html_url or None,
        data={
            "announcement_id": str(announcement.id),
            "severity": announcement.severity.value,
            "version": version,
            "starts_at": announcement.starts_at.isoformat() if announcement.starts_at else None,
            "ends_at": announcement.ends_at.isoformat() if announcement.ends_at else None,
        },
    )


async def _check_for_updates() -> None:
    current_str = settings.app_version
    if current_str == "dev":
        return
    try:
        current = Version(current_str)
    except InvalidVersion:
        logger.warning("update_check: invalid APP_VERSION=%r, skipping", current_str)
        return

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(_RELEASES_URL, headers={"Accept": "application/vnd.github+json"})
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        logger.warning("update_check: failed to reach GitHub, skipping", exc_info=True)
        return

    tag: str = data.get("tag_name", "").lstrip("v")
    html_url: str = data.get("html_url", "")
    release_notes: str = (data.get("body") or "")[:400]

    try:
        latest = Version(tag)
    except InvalidVersion:
        logger.warning("update_check: unparseable tag %r from GitHub, skipping", tag)
        return

    if latest <= current:
        return

    logger.info("update_check: new version %s available (running %s)", tag, current_str)

    async with AsyncSessionLocal() as db:
        repo = AppAnnouncementRepository(db)
        existing_announcement = await repo.find_by_version(tag)
        if existing_announcement is not None:
            count = await _ensure_update_notification(
                db,
                announcement=existing_announcement,
                version=tag,
                html_url=html_url,
            )
            if count:
                logger.info("update_check: re-notified %d admins of version %s", count, tag)
            return

        body = _build_update_message(current_str, tag, release_notes)

        announcement = AppAnnouncement(
            version=tag,
            title=f"Zukan {tag} is available",
            message=body.strip(),
            severity=AnnouncementSeverity.info,
            is_active=True,
        )
        db.add(announcement)
        await db.commit()
        await db.refresh(announcement)

        count = await _ensure_update_notification(db, announcement=announcement, version=tag, html_url=html_url)
        logger.info("update_check: notified %d admins of version %s", count, tag)


async def check_for_updates_now() -> dict:
    current_str = settings.app_version
    if current_str == "dev":
        return {
            "current_version": current_str,
            "latest_version": None,
            "up_to_date": True,
            "message": "Running a development build — update check skipped.",
        }

    try:
        current = Version(current_str)
    except InvalidVersion:
        return {
            "current_version": current_str,
            "latest_version": None,
            "up_to_date": True,
            "message": f"Could not parse current version {current_str!r}.",
        }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(_RELEASES_URL, headers={"Accept": "application/vnd.github+json"})
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("check_for_updates_now: failed to reach GitHub: %s", exc)
        return {
            "current_version": current_str,
            "latest_version": None,
            "up_to_date": True,
            "message": "Could not reach GitHub to check for updates.",
        }

    tag: str = data.get("tag_name", "").lstrip("v")
    html_url: str = data.get("html_url", "")
    release_notes: str = (data.get("body") or "")[:400]

    try:
        latest = Version(tag)
    except InvalidVersion:
        return {
            "current_version": current_str,
            "latest_version": tag or None,
            "up_to_date": True,
            "message": f"Could not parse latest version tag {tag!r} from GitHub.",
        }

    if latest <= current:
        return {
            "current_version": current_str,
            "latest_version": tag,
            "up_to_date": True,
            "message": f"You are running the latest version ({current_str}).",
        }

    logger.info("check_for_updates_now: new version %s available (running %s)", tag, current_str)

    async with AsyncSessionLocal() as db:
        repo = AppAnnouncementRepository(db)
        existing_announcement = await repo.find_by_version(tag)
        if existing_announcement is None:
            body = _build_update_message(current_str, tag, release_notes)

            announcement = AppAnnouncement(
                version=tag,
                title=f"Zukan {tag} is available",
                message=body.strip(),
                severity=AnnouncementSeverity.info,
                is_active=True,
            )
            db.add(announcement)
            await db.commit()
            await db.refresh(announcement)
        else:
            announcement = existing_announcement

        await _ensure_update_notification(db, announcement=announcement, version=tag, html_url=html_url)

    return {
        "current_version": current_str,
        "latest_version": tag,
        "up_to_date": False,
        "message": _build_update_message(current_str, tag),
    }


async def update_check_worker() -> None:
    while True:
        try:
            await _check_for_updates()
        except Exception:
            logger.exception("update_check: unhandled error during check")
        await asyncio.sleep(settings.update_poll_interval_seconds)


async def trigger_app_update() -> None:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.updater_url}/update",
            headers={"Authorization": f"Bearer {settings.updater_token}"},
        )
        resp.raise_for_status()
    logger.info("update_check: updater service triggered")
