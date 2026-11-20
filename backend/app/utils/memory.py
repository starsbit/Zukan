"""Hand freed heap memory back to the OS.

Image decoding and ONNX inference allocate large temporary buffers from
several worker threads. glibc keeps freed memory in per-thread malloc
arenas instead of returning it to the kernel, so after a few large uploads
the API process keeps gigabytes of RSS it no longer uses. ``malloc_trim``
releases that memory. On platforms without glibc this is a no-op.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import logging
import sys

logger = logging.getLogger(__name__)

_malloc_trim = None
if sys.platform.startswith("linux"):
    try:
        _libc = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6")
        _malloc_trim = _libc.malloc_trim
        _malloc_trim.argtypes = [ctypes.c_size_t]
        _malloc_trim.restype = ctypes.c_int
    except (OSError, AttributeError):
        _malloc_trim = None


def release_freed_memory() -> bool:
    """Return freed heap pages to the OS. Returns True if anything was released."""
    if _malloc_trim is None:
        return False
    try:
        return bool(_malloc_trim(0))
    except Exception:  # pragma: no cover - defensive, never fail a worker over this
        logger.debug("malloc_trim failed", exc_info=True)
        return False
