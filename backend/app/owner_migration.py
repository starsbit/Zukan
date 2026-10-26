"""Read-only upgrade preflight: python -m backend.app.owner_migration preflight."""

import asyncio
import json
import sys
from sqlalchemy import text
from backend.app.database import AsyncSessionLocal


async def preflight():
    async with AsyncSessionLocal() as db:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        candidates = (
            (
                await db.execute(
                    text(
                        "SELECT id, username, email FROM users ORDER BY created_at, id"
                    )
                )
            )
            .mappings()
            .all()
        )
        counts = {}
        for table in (
            "media",
            "albums",
            "user_favorites",
            "tags",
            "owned_entities",
            "import_batches",
            "media_embeddings",
        ):
            counts[table] = await db.scalar(text(f"SELECT count(*) FROM {table}"))
        collisions = {}
        for name, query in {
            "tags": "SELECT name, count(*) FROM tags GROUP BY name HAVING count(*) > 1",
            "entities": "SELECT entity_type, normalized_name, count(*) FROM owned_entities GROUP BY entity_type, normalized_name HAVING count(*) > 1",
            "media_hashes": "SELECT sha256, count(*) FROM media WHERE sha256 IS NOT NULL GROUP BY sha256 HAVING count(*) > 1",
        }.items():
            collisions[name] = [
                dict(row) for row in (await db.execute(text(query))).mappings()
            ]
        print(
            json.dumps(
                {
                    "owner_candidates": [dict(row) for row in candidates],
                    "counts": counts,
                    "collisions": collisions,
                },
                default=str,
                indent=2,
            )
        )


if __name__ == "__main__":
    if sys.argv[1:] != ["preflight"]:
        raise SystemExit("Usage: python -m backend.app.owner_migration preflight")
    asyncio.run(preflight())
