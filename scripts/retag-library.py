#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from backend.app.config import settings  # noqa: E402

DEFAULT_BACKEND = "pixai_v1_336_int8"
DEFAULT_STATE = ".retag-state.jsonl"
PAGE_SIZE = 500
MAX_ATTEMPTS = 5
FINAL_STATUSES = {"done", "failed"}


@dataclass(frozen=True)
class MediaItem:
    id: str
    filename: str
    media_type: str


@dataclass
class Counters:
    done: int = 0
    failed: int = 0
    skipped: int = 0
    errors: int = 0

    @property
    def processed(self) -> int:
        return self.done + self.failed + self.skipped + self.errors


class RetryableStatus(Exception):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Retag the whole Zukan library locally and import the results through the API."
    )
    parser.add_argument("--url", required=True, help="Zukan base URL, e.g. https://zukan.example")
    parser.add_argument("--api-key", default=os.environ.get("ZUKAN_API_KEY"), help="Zukan API key (or ZUKAN_API_KEY).")
    parser.add_argument("--backend", default=DEFAULT_BACKEND, help=f"Tagger backend. Default: {DEFAULT_BACKEND}")
    parser.add_argument("--state", default=DEFAULT_STATE, help=f"Resume file (JSONL). Default: {DEFAULT_STATE}")
    parser.add_argument("--model-cache", default=str(settings.model_cache_dir), help="Model download cache directory.")
    parser.add_argument("--concurrency", type=int, default=4, help="Parallel downloads. Default: 4")
    parser.add_argument("--threads", type=int, default=os.cpu_count() or 4, help="ONNX inference threads.")
    parser.add_argument("--limit", type=int, default=None, help="Stop after processing this many items.")
    parser.add_argument("--dry-run", action="store_true", help="Run inference and print results without importing.")
    parser.add_argument("--retry-failed", action="store_true", help="Reprocess items that previously ended as failed.")
    parser.add_argument("--timeout", type=float, default=120.0, help="HTTP timeout in seconds. Default: 120")
    args = parser.parse_args()
    if not args.api_key:
        parser.error("--api-key or ZUKAN_API_KEY is required")
    return args


def load_state(path: Path) -> dict[str, str]:
    statuses: dict[str, str] = {}
    if not path.exists():
        return statuses
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict) and "id" in record and "status" in record:
                statuses[str(record["id"])] = str(record["status"])
    return statuses


def append_state(path: Path, record: dict[str, Any]) -> None:
    record = {**record, "at": datetime.now(timezone.utc).isoformat()}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


async def request(client: httpx.AsyncClient, method: str, url: str, **kwargs) -> httpx.Response:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = await client.request(method, url, **kwargs)
            if response.status_code == 429 or response.status_code >= 500:
                raise RetryableStatus(f"HTTP {response.status_code}")
            return response
        except (httpx.TransportError, RetryableStatus):
            if attempt == MAX_ATTEMPTS:
                raise
            await asyncio.sleep(min(60, 2**attempt))
    raise AssertionError("unreachable")


async def list_media(client: httpx.AsyncClient) -> list[MediaItem]:
    items: list[MediaItem] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {
            "page_size": PAGE_SIZE,
            "sort_by": "uploaded_at",
            "sort_order": "asc",
            "include_total": "false",
        }
        if cursor:
            params["after"] = cursor
        response = await request(client, "GET", "/api/v1/media", params=params)
        response.raise_for_status()
        page = response.json()
        for row in page["items"]:
            if row.get("file_status", "available") != "available":
                continue
            items.append(MediaItem(id=row["id"], filename=row["filename"], media_type=row["media_type"]))
        cursor = page.get("next_cursor")
        if not page.get("has_more") or not cursor:
            return items


async def download(client: httpx.AsyncClient, item: MediaItem, workdir: Path) -> Path:
    target = workdir / f"{item.id}{Path(item.filename).suffix.lower()}"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            async with client.stream("GET", f"/api/v1/media/{item.id}/file") as response:
                if response.status_code == 429 or response.status_code >= 500:
                    raise RetryableStatus(f"HTTP {response.status_code}")
                response.raise_for_status()
                with target.open("wb") as handle:
                    async for chunk in response.aiter_bytes(1 << 20):
                        handle.write(chunk)
            return target
        except (httpx.TransportError, RetryableStatus):
            target.unlink(missing_ok=True)
            if attempt == MAX_ATTEMPTS:
                raise
            await asyncio.sleep(min(60, 2**attempt))
    raise AssertionError("unreachable")


async def run_tagger(tagger, path: Path, media_type: str):
    from backend.app.models.media import MediaType
    from backend.app.utils.frame_sampling import cleanup_sampled_frames, sample_frames_from_path
    from backend.app.utils.tagging import aggregate_tagging_results

    frames = await asyncio.to_thread(sample_frames_from_path, path, MediaType(media_type))
    if not frames:
        raise RuntimeError("no frames could be sampled (is ffmpeg installed?)")
    try:
        return aggregate_tagging_results([await tagger.predict(str(frame)) for frame in frames])
    finally:
        await asyncio.to_thread(cleanup_sampled_frames, [frame for frame in frames if frame != path])


def predicted_entities(result) -> tuple[list[str], list[str]]:
    from backend.app.utils.tagging import derive_series_predictions

    characters = [p.name for p in result.predictions if p.category == 4]
    series = [p.name for p in derive_series_predictions(result.predictions)]
    return characters, series


def entity_names(detail: dict[str, Any], entity_type: str) -> list[str]:
    return [e["name"] for e in detail.get("entities", []) if e.get("entity_type") == entity_type]


async def downloader(
    client: httpx.AsyncClient,
    pending: asyncio.Queue,
    ready: asyncio.Queue,
    workdir: Path,
) -> None:
    while True:
        item = await pending.get()
        if item is None:
            await ready.put(None)
            return
        try:
            await ready.put((item, await download(client, item, workdir), None))
        except Exception as exc:
            await ready.put((item, None, f"download failed: {exc}"))


def format_eta(seconds: float) -> str:
    seconds = int(seconds)
    return f"{seconds // 3600}h{(seconds % 3600) // 60:02d}m"


def print_progress(counters: Counters, total: int, started_at: float) -> None:
    elapsed = max(1e-6, time.monotonic() - started_at)
    rate = counters.processed / elapsed
    eta = format_eta((total - counters.processed) / rate) if rate > 0 else "?"
    print(
        f"\r[{counters.processed}/{total}] done={counters.done} failed={counters.failed} "
        f"skipped={counters.skipped} errors={counters.errors} {rate:.2f}/s eta={eta}   ",
        end="",
        flush=True,
    )


async def process(args: argparse.Namespace) -> int:
    settings.model_cache_dir = Path(args.model_cache)
    settings.tagger_executor_workers = max(1, args.threads)
    settings.processing_temp_dir = None
    from backend.app.ml.tagger import create_tagger

    state_path = Path(args.state)
    statuses = load_state(state_path)
    skip_statuses = {"done"} if args.retry_failed else FINAL_STATUSES

    headers = {"Authorization": f"Bearer {args.api_key}"}
    async with httpx.AsyncClient(base_url=args.url.rstrip("/"), headers=headers, timeout=args.timeout) as client:
        print("Listing media...", flush=True)
        all_items = await list_media(client)
        todo = [item for item in all_items if statuses.get(item.id) not in skip_statuses]
        if args.limit is not None:
            todo = todo[: args.limit]
        print(f"{len(all_items)} media in library, {len(todo)} to process", flush=True)
        if not todo:
            return 0

        print(f"Loading tagger {args.backend}...", flush=True)
        tagger = create_tagger(args.backend)
        await asyncio.to_thread(tagger.load)

        workdir = Path(tempfile.mkdtemp(prefix="zukan-retag-"))
        pending: asyncio.Queue = asyncio.Queue()
        ready: asyncio.Queue = asyncio.Queue(maxsize=max(2, args.concurrency * 2))
        for item in todo:
            pending.put_nowait(item)
        workers = max(1, args.concurrency)
        for _ in range(workers):
            pending.put_nowait(None)
        download_tasks = [asyncio.create_task(downloader(client, pending, ready, workdir)) for _ in range(workers)]

        counters = Counters()
        failed_ids: list[str] = []
        started_at = time.monotonic()
        finished_workers = 0
        try:
            while finished_workers < workers:
                entry = await ready.get()
                if entry is None:
                    finished_workers += 1
                    continue
                item, path, error = entry
                record: dict[str, Any] = {"id": item.id, "filename": item.filename}
                try:
                    if error is not None:
                        raise RuntimeError(error)
                    result = await run_tagger(tagger, path, item.media_type)
                    characters, series = predicted_entities(result)
                    if args.dry_run:
                        print(f"\n{item.id} {item.filename} character={characters} series={series}", flush=True)
                        counters.done += 1
                        continue
                    payload = {
                        "predictions": [
                            {"name": p.name, "category": p.category, "confidence": min(1.0, max(0.0, p.confidence))}
                            for p in result.predictions
                        ],
                        "is_nsfw": result.is_nsfw,
                        "is_sensitive": result.is_sensitive,
                    }
                    response = await request(client, "PUT", f"/api/v1/media/{item.id}/tagging-result", json=payload)
                    if response.status_code == 409:
                        counters.skipped += 1
                        record.update(status="skipped", error="tagging job queued or running on server")
                    elif response.status_code == 404:
                        counters.skipped += 1
                        record.update(status="skipped", error="media not found or trashed")
                    else:
                        response.raise_for_status()
                        detail = response.json()
                        status = "failed" if detail.get("tagging_status") == "failed" else "done"
                        record.update(
                            status=status,
                            character=entity_names(detail, "character"),
                            series=entity_names(detail, "series"),
                            error=detail.get("tagging_error"),
                        )
                        if status == "failed":
                            counters.failed += 1
                            failed_ids.append(item.id)
                        else:
                            counters.done += 1
                except Exception as exc:
                    counters.errors += 1
                    record.update(status="error", error=f"{exc.__class__.__name__}: {exc}"[:500])
                finally:
                    if path is not None:
                        path.unlink(missing_ok=True)
                if not args.dry_run:
                    append_state(state_path, record)
                print_progress(counters, len(todo), started_at)
        finally:
            for task in download_tasks:
                task.cancel()
            await asyncio.gather(*download_tasks, return_exceptions=True)
            shutil.rmtree(workdir, ignore_errors=True)

    print()
    print(
        f"Finished: done={counters.done} failed={counters.failed} "
        f"skipped={counters.skipped} errors={counters.errors}"
    )
    if failed_ids:
        print(f"{len(failed_ids)} media have no character or series (tags were still imported):")
        for media_id in failed_ids:
            print(f"  {media_id}")
    if counters.errors or counters.skipped:
        print(f"Errors and skipped items are retried on the next run. Details in {state_path}")
    return 1 if counters.errors else 0


def main() -> int:
    args = parse_args()
    try:
        return asyncio.run(process(args))
    except KeyboardInterrupt:
        print("\nInterrupted. Progress is saved; rerun to resume.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
