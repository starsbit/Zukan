import httpx
import pytest

from backend.app.config import settings
from backend.app.services import storage_gate as module
from backend.app.storage.filesystem import prepare_library_root


@pytest.mark.asyncio
async def test_disconnected_mount_keeps_metadata_accessible_but_blocks_assets_and_uploads(
    tmp_path, monkeypatch
):
    identity = prepare_library_root(tmp_path)
    (tmp_path / ".zukan-library-id").unlink()
    monkeypatch.setattr(settings, "storage_dir", tmp_path)
    monkeypatch.setattr(settings, "library_paths_relative", True)
    monkeypatch.setattr(settings, "library_root_identity", identity)
    monkeypatch.setattr(module, "storage_gate", module.StorageGate())

    async def app(scope, receive, send):
        from starlette.responses import JSONResponse

        await JSONResponse({"ok": True})(scope, receive, send)

    transport = httpx.ASGITransport(app=module.StorageMiddleware(app))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/api/v1/media")).status_code == 200
        assert (await client.get("/api/v1/me")).status_code == 200
        assert (await client.get("/api/v1/media/test/file")).status_code == 503
        assert (await client.post("/api/v1/media/upload")).status_code == 503
        assert (await client.get("/api/v1/albums/test/download")).status_code == 503
        assert (await client.get("/api/v1/admin/storage")).status_code == 200
