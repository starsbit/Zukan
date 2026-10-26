"""Drain file operations before migration, and readers only during cutover."""

import asyncio
from contextlib import asynccontextmanager
from backend.app.storage.filesystem import current_filesystem, StorageUnavailable
from backend.app.storage.io import run_storage_io


class StorageGate:
    def __init__(self):
        self.condition = asyncio.Condition()
        self.migration_lock = asyncio.Lock()
        self.pending = False
        self.paused = False
        self.frozen = False
        self.writers = 0
        self.readers = 0
        self.available = True

    @asynccontextmanager
    async def operation(
        self, *, writer=True, wait_for_storage=False, require_available=None
    ):
        if require_available is None:
            require_available = writer
        while True:
            # NAS metadata calls can block as well as file reads. Never perform
            # them under the condition lock or on the API event loop.
            async with self.condition:
                await self.condition.wait_for(
                    lambda: not self.frozen and (not writer or not self.paused)
                )
            available = not require_available or await run_storage_io(
                current_filesystem().available
            )
            async with self.condition:
                if self.frozen or (writer and self.paused):
                    continue
                if require_available:
                    self.available = available
                if available:
                    if writer:
                        self.writers += 1
                    else:
                        self.readers += 1
                    break
            if not wait_for_storage:
                raise StorageUnavailable("Library storage is unavailable")
            await asyncio.sleep(5)
        try:
            yield
        finally:
            async with self.condition:
                if writer:
                    self.writers -= 1
                else:
                    self.readers -= 1
                self.condition.notify_all()

    @asynccontextmanager
    async def migration(self):
        async with self.migration_lock:
            async with self.condition:
                self.pending = False
                self.paused = True
                await self.condition.wait_for(lambda: self.writers == 0)
            try:
                yield
            finally:
                async with self.condition:
                    self.paused = self.pending
                    self.condition.notify_all()

    @asynccontextmanager
    async def cutover(self):
        async with self.condition:
            self.frozen = True
            await self.condition.wait_for(
                lambda: self.readers == 0 and self.writers == 0
            )
        try:
            yield
        finally:
            async with self.condition:
                self.frozen = False
                self.condition.notify_all()


storage_gate = StorageGate()


class StorageMiddleware:
    """Pure ASGI middleware holds the lease until streaming responses finish."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or not path.startswith("/api/")
            or "/admin/storage" in path
        ):
            return await self.app(scope, receive, send)
        writer = scope.get("method") not in (
            "GET",
            "HEAD",
            "OPTIONS",
        ) and path.startswith("/api/v1/media")
        asset_read = path.startswith(("/api/v1/media", "/api/v1/albums")) and (
            path.endswith(("/file", "/thumbnail", "/poster", "/download"))
        )
        from starlette.responses import JSONResponse

        if writer and storage_gate.paused:
            return await JSONResponse(
                {"detail": "Storage is migrating; retry later"}, status_code=503
            )(scope, receive, send)
        response_started = False

        async def tracked_send(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            async with storage_gate.operation(
                writer=writer, require_available=writer or asset_read
            ):
                await self.app(scope, receive, tracked_send)
        except StorageUnavailable:
            if response_started:
                raise
            return await JSONResponse(
                {"detail": "Library storage is unavailable; metadata is retained"},
                status_code=503,
                headers={"Retry-After": "30"},
            )(scope, receive, send)
