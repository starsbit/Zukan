from __future__ import annotations

import asyncio
import os
import resource
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Deque

try:
    import psutil
except ImportError:  # pragma: no cover - exercised through fallback path when dependency is absent
    psutil = None


@dataclass(slots=True)
class HealthSnapshot:
    captured_at: datetime
    cpu_percent: float
    memory_rss_bytes: int


class SystemHealthMonitor:
    def __init__(self, *, max_samples: int = 120, sample_interval_seconds: float = 5.0) -> None:
        self._max_samples = max_samples
        self._sample_interval_seconds = sample_interval_seconds
        self._process = psutil.Process(os.getpid()) if psutil is not None else None
        self._samples: Deque[HealthSnapshot] = deque(maxlen=max_samples)
        self._started_at = time.monotonic()
        self._task: asyncio.Task | None = None
        self._last_cpu_time = time.process_time()
        self._last_wall_time = time.monotonic()

    @property
    def started_at(self) -> float:
        return self._started_at

    def start(self) -> None:
        if self._task is None:
            self.capture_sample()
            self._task = asyncio.create_task(self._sampler())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    def capture_sample(self) -> HealthSnapshot:
        sample = HealthSnapshot(
            captured_at=datetime.now(UTC),
            cpu_percent=self._cpu_percent(),
            memory_rss_bytes=self._memory_rss_bytes(),
        )
        self._samples.append(sample)
        return sample

    def samples(self) -> list[HealthSnapshot]:
        return list(self._samples)

    def uptime_seconds(self) -> float:
        return max(0.0, time.monotonic() - self._started_at)

    def system_memory(self) -> tuple[int | None, int | None]:
        if self._process is not None:
            memory = psutil.virtual_memory()
            return int(memory.total), int(memory.used)
        return None, None

    async def _sampler(self) -> None:
        while True:
            await asyncio.sleep(self._sample_interval_seconds)
            self.capture_sample()

    def _cpu_percent(self) -> float:
        if self._process is not None:
            return round(float(self._process.cpu_percent(interval=None)), 2)

        current_cpu_time = time.process_time()
        current_wall_time = time.monotonic()
        wall_delta = max(current_wall_time - self._last_wall_time, 1e-6)
        cpu_delta = max(current_cpu_time - self._last_cpu_time, 0.0)
        self._last_cpu_time = current_cpu_time
        self._last_wall_time = current_wall_time
        return round((cpu_delta / wall_delta) * 100.0, 2)

    def _memory_rss_bytes(self) -> int:
        if self._process is not None:
            return int(self._process.memory_info().rss)

        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if os.name == "posix" and "darwin" in os.uname().sysname.lower():
            return int(rss)
        return int(rss * 1024)
