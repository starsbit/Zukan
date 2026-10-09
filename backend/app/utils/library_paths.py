"""Filesystem boundary for all library assets (including legacy installations)."""
from pathlib import Path
from backend.app.config import settings


def root_path() -> Path:
    return settings.storage_dir.resolve()


def contained_path(root: Path, relative: str) -> Path:
    raw = Path(relative)
    if raw.is_absolute() or '..' in raw.parts:
        raise ValueError('Library paths must be relative and cannot contain traversal')
    target = root / raw
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Library path escapes the configured root')
    # Do not follow symlinks, even those pointing inside the library.
    current = target
    while current != root:
        if current.is_symlink():
            raise ValueError('Symlinks are not supported in the library')
        current = current.parent
    return target


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
    return str(Path(value).resolve().relative_to(root_path()))


def validate_generated_dir(value: str) -> str:
    if not value or value == '.' or not Path(value).parts[0].startswith('.'):
        raise ValueError('Generated files must use a hidden subfolder, such as .zukan')
    contained_path(root_path(), value)
    return value
