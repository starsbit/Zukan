"""Filesystem boundary for all library assets (including legacy installations)."""

from pathlib import Path
from backend.app.config import settings
from backend.app.storage.filesystem import contained_path


def root_path() -> Path:
    return settings.storage_dir.absolute()


def resolve_media_path(value: str | Path) -> Path:
    raw = Path(value)
    if not settings.library_paths_relative:
        # Compatibility until the startup conversion completes.
        if raw.is_absolute() or raw.is_relative_to(settings.storage_dir):
            return raw
    if raw.is_absolute():
        raw = raw.relative_to(root_path())
    return contained_path(root_path(), str(raw))


def stored_path(value: str | Path) -> str:
    if not settings.library_paths_relative:
        return str(value)
    # Validate symlink/traversal rules before persisting a relative key.
    path = Path(value).absolute()
    relative = path.relative_to(root_path())
    contained_path(root_path(), relative)
    return str(relative)


def validate_generated_dir(value: str) -> str:
    if not value or value == "." or not Path(value).parts[0].startswith("."):
        raise ValueError("Generated files must use a hidden subfolder, such as .zukan")
    contained_path(root_path(), value)
    return value
