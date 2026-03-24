# Migration plan

- Alembic is now the source of truth for schema changes.
- New changes to tables, indexes, enums, functions, and triggers should be added as Alembic revisions in migrations/versions.
- App startup runs `alembic upgrade head` through backend.app.database.init_db.

Typical workflow

1. Generate a revision:
   alembic -c alembic.ini revision -m "describe change"
2. Edit the new file in migrations/versions and add upgrade/downgrade SQL.
3. Apply migrations:
   alembic -c alembic.ini upgrade head

Notes

- Async runtime DB URL is reused from backend.app.config.settings.database_url.
- For production, running Alembic in deployment remains recommended; startup migration is currently enabled for convenience.
