"""Drain file operations before migration, and readers only during cutover."""
import asyncio
from contextlib import asynccontextmanager


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
    async def operation(self, *, writer=True, wait_for_storage=False, require_available=True):
        while True:
            async with self.condition:
                await self.condition.wait_for(lambda: not self.frozen and (not writer or not self.paused))
                if writer and require_available:
                    from backend.app.services.library_storage import storage_available
                    self.available = storage_available()
                if not writer or not require_available or self.available:
                    if writer:
                        self.writers += 1
                    else:
                        self.readers += 1
                    break
            if not wait_for_storage:
                raise OSError('Library storage is unavailable')
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
            await self.condition.wait_for(lambda: self.readers == 0 and self.writers == 0)
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
        path = scope.get('path', '')
        if scope['type'] != 'http' or not path.startswith('/api/') or '/admin/storage' in path:
            return await self.app(scope, receive, send)
        writer = scope.get('method') not in ('GET', 'HEAD', 'OPTIONS') and any(
            path.startswith(prefix) for prefix in ('/api/v1/media', '/api/v1/admin/users')
        )
        if writer:
            from backend.app.services.library_storage import storage_available
            storage_gate.available = await asyncio.to_thread(storage_available)
        if writer and (storage_gate.paused or not storage_gate.available):
            from starlette.responses import JSONResponse
            return await JSONResponse({'detail': 'Storage is migrating or unavailable; retry later'}, status_code=503)(scope, receive, send)
        async with storage_gate.operation(writer=writer):
            await self.app(scope, receive, send)
