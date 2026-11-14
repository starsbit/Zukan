from __future__ import annotations

from sqlalchemy import func

from backend.app.config import settings
from backend.app.models.media import Media


def effective_nsfw_value(media: object) -> bool:
    override = getattr(media, "is_nsfw_override", None)
    if override is not None:
        return bool(override)
    return bool(getattr(media, "is_nsfw", False))


def effective_sensitive_value(media: object) -> bool:
    override = getattr(media, "is_sensitive_override", None)
    if override is not None:
        return bool(override)
    return bool(getattr(media, "is_sensitive", False))


def effective_nsfw_expr():
    return func.coalesce(Media.is_nsfw_override, Media.is_nsfw)


def effective_sensitive_expr():
    return func.coalesce(Media.is_sensitive_override, Media.is_sensitive)


def hides_nsfw(user: object) -> bool:
    return settings.demo_mode or not getattr(user, "show_nsfw", False)


def hides_sensitive(user: object) -> bool:
    return settings.demo_mode or not getattr(user, "show_sensitive", False)


def hidden_in_demo(media: object) -> bool:
    return settings.demo_mode and (effective_nsfw_value(media) or effective_sensitive_value(media))
