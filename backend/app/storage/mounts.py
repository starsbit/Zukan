"""Mount namespace inspection, including Linux bind mounts.

os.path.ismount cannot identify same-device bind mounts reliably. Linux exposes
mount IDs, mountpoints and filesystem types in /proc/self/mountinfo:
https://man7.org/linux/man-pages/man5/proc_pid_mountinfo.5.html
"""

import re
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class MountedVolume:
    mount_id: int | None
    filesystem_type: str | None


def _decode(value: str) -> str:
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), value)


def linux_mount_at(path: Path, mountinfo: str) -> MountedVolume | None:
    candidates = []
    for line in mountinfo.splitlines():
        columns = line.split()
        try:
            separator = columns.index("-")
            if Path(_decode(columns[4])) == path:
                candidates.append(
                    (int(columns[0]), int(columns[1]), columns[separator + 1])
                )
        except (ValueError, IndexError):
            continue
    # An overmounted entry is the parent of another mount at this same path.
    parents = {parent for identifier, parent, _ in candidates if parent != identifier}
    for identifier, _, filesystem in reversed(candidates):
        if identifier not in parents:
            return MountedVolume(identifier, filesystem)
    return None


def mount_at(path: Path) -> MountedVolume | None:
    path = path.absolute()
    if sys.platform.startswith("linux"):
        return linux_mount_at(path, Path("/proc/self/mountinfo").read_text())
    return MountedVolume(None, None) if path.is_mount() else None
