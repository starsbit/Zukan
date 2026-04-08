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


async def check_for_updates() -> None:
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
        if await repo.find_by_version(tag):
            return

        body = f"Zukan {tag} is available. You are running {current_str}."
        if release_notes:
            body += f"\n\n{release_notes}"
        if html_url:
            body += f"\n\nRelease notes: {html_url}"

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
        count = await NotificationService(db).publish_announcement(announcement)
        logger.info("update_check: notified %d users of version %s", count, tag)
