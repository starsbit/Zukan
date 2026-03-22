from __future__ import annotations

import atexit
import asyncio
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from PIL import Image as PILImage

from backend.app.services.tagger import TagPrediction, TaggingResult
import backend.app.main as main_module
import backend.app.services.tagger as tagger_module

_managed_db_container: str | None = None


async def fake_predict(image_path: str) -> TaggingResult:
    await asyncio.sleep(1.0)

    with PILImage.open(image_path) as image:
        r, g, b = image.convert("RGB").getpixel((0, 0))

    if r < 20 and g < 20 and b < 20:
        raise RuntimeError("Synthetic tagging failure")

    if r > 200 and g < 120 and b < 120:
        return TaggingResult(
            predictions=[
                TagPrediction(name="rose", category=0, confidence=0.97),
                TagPrediction(name="warm", category=0, confidence=0.88),
                TagPrediction(name="rating:questionable", category=9, confidence=0.99),
            ],
            character_name=None,
            is_nsfw=True,
        )

    if b > 200:
        return TaggingResult(
            predictions=[
                TagPrediction(name="ayanami_rei", category=4, confidence=0.98),
                TagPrediction(name="sky", category=0, confidence=0.96),
                TagPrediction(name="blue", category=0, confidence=0.9),
                TagPrediction(name="rating:general", category=9, confidence=0.99),
            ],
            character_name="ayanami_rei",
            is_nsfw=False,
        )

    return TaggingResult(
        predictions=[
            TagPrediction(name="forest", category=0, confidence=0.95),
            TagPrediction(name="green", category=0, confidence=0.87),
            TagPrediction(name="rating:general", category=9, confidence=0.99),
        ],
        character_name=None,
        is_nsfw=False,
    )


def main() -> None:
    try:
        if os.environ.get("E2E_MANAGE_DB") == "1":
            register_db_cleanup_handlers()
            start_postgres_container()

        tagger_module.tagger.load = lambda: None
        tagger_module.tagger.predict = fake_predict

        @main_module.api.get("/healthz", include_in_schema=False)
        async def healthcheck():
            return {"status": "ok"}

        import uvicorn

        uvicorn.run(
            main_module.api,
            host=os.environ.get("HOST", "127.0.0.1"),
            port=int(os.environ.get("PORT", "8000")),
            log_level=os.environ.get("LOG_LEVEL", "info"),
        )
    finally:
        cleanup_managed_db_container()


def register_db_cleanup_handlers() -> None:
    atexit.register(cleanup_managed_db_container)

    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, _handle_exit_signal)


def _handle_exit_signal(signum: int, _frame) -> None:
    cleanup_managed_db_container()
    raise SystemExit(128 + signum)


def start_postgres_container() -> str:
    global _managed_db_container

    container_name = os.environ.get("E2E_DB_CONTAINER", "zukan-e2e-db")
    port = os.environ.get("E2E_DB_PORT", "55432")

    subprocess.run(
        ["docker", "rm", "--force", "--volumes", container_name],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    subprocess.run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            container_name,
            "--publish",
            f"{port}:5432",
            "--env",
            "POSTGRES_USER=zukan",
            "--env",
            "POSTGRES_PASSWORD=zukan",
            "--env",
            "POSTGRES_DB=zukan",
            "--tmpfs",
            "/var/lib/postgresql/data",
            "postgres:16-alpine",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _managed_db_container = container_name

    deadline = time.time() + 30
    while time.time() < deadline:
        ready = subprocess.run(
            ["docker", "exec", container_name, "pg_isready", "-U", "zukan"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if ready.returncode == 0:
            return container_name
        time.sleep(1)

    cleanup_managed_db_container()
    raise RuntimeError(f"Timed out waiting for PostgreSQL container {container_name}")


def stop_postgres_container(container_name: str) -> None:
    subprocess.run(
        ["docker", "rm", "--force", "--volumes", container_name],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def cleanup_managed_db_container() -> None:
    global _managed_db_container

    if _managed_db_container is None:
        return

    stop_postgres_container(_managed_db_container)
    _managed_db_container = None


if __name__ == "__main__":
    main()
