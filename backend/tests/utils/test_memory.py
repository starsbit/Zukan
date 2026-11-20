import sys

from backend.app.utils import memory


def test_release_freed_memory_returns_bool():
    assert isinstance(memory.release_freed_memory(), bool)


def test_release_freed_memory_is_noop_without_malloc_trim(monkeypatch):
    monkeypatch.setattr(memory, "_malloc_trim", None)
    assert memory.release_freed_memory() is False


def test_release_freed_memory_swallows_errors(monkeypatch):
    def boom(_pad):
        raise RuntimeError("boom")

    monkeypatch.setattr(memory, "_malloc_trim", boom)
    assert memory.release_freed_memory() is False


def test_malloc_trim_available_on_linux():
    if sys.platform.startswith("linux"):
        assert memory._malloc_trim is not None
