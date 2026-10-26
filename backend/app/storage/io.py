"""Bound storage I/O without blocking the API event loop.

Cancellation waits for an in-flight operation: dropping a storage lease while a
thread still writes would allow migration cutover to race the write. Mount I/O
limits and recovery time are controlled by the operating system's NFS/SMB client.
"""

import asyncio
from functools import partial
from weakref import WeakKeyDictionary
from typing import Callable, ParamSpec, TypeVar

import anyio

P = ParamSpec("P")
R = TypeVar("R")
_limiters: WeakKeyDictionary[asyncio.AbstractEventLoop, anyio.CapacityLimiter] = (
    WeakKeyDictionary()
)


async def run_storage_io(
    function: Callable[P, R], *args: P.args, **kwargs: P.kwargs
) -> R:
    loop = asyncio.get_running_loop()
    if loop not in _limiters:
        _limiters[loop] = anyio.CapacityLimiter(4)
    work = asyncio.create_task(
        anyio.to_thread.run_sync(
            partial(function, *args, **kwargs),
            abandon_on_cancel=False,
            limiter=_limiters[loop],
        )
    )
    cancelled = False
    # ASGI servers can cancel the raw asyncio task, outside AnyIO cancel scopes.
    # Shield the worker task as well, then deliver cancellation after it exits.
    with anyio.CancelScope(shield=True):
        while True:
            try:
                result = await asyncio.shield(work)
                break
            except asyncio.CancelledError:
                if work.cancelled():
                    raise
                cancelled = True
    if cancelled:
        raise asyncio.CancelledError
    return result
