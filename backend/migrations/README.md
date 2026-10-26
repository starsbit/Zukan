# Migration plan

- `0001_release_baseline.py` is the first-release schema baseline.
- The baseline is the source of truth for a brand-new production database and intentionally replaces the pre-release migration chain.
- App startup still runs `alembic upgrade head` through `backend.app.database.init_db`.

Typical workflow after the first release

1. Generate a new revision:
   `alembic -c alembic.ini revision -m "describe change"`
2. Edit the new file in `migrations/versions` and add upgrade/downgrade SQL.
3. Apply migrations:
   `alembic -c alembic.ini upgrade head`

Notes

- Async runtime DB URL is reused from `backend.app.config.settings.database_url`.
- The release baseline already includes the current live schema, enums, triggers, and tag-count maintenance functions.
- Removed pre-release AniList and integration experiments are intentionally not part of the release baseline.
- For production, running Alembic in deployment remains recommended; startup migration is still enabled for convenience.

## Single-owner breaking migration (0022)

Stop the API/workers and back up PostgreSQL plus the library. Run
`python -m backend.app.owner_migration preflight` against the old database, then
set `SINGLE_USER_OWNER_ID` to an existing account UUID before upgrading to head.
All media records and paths survive, including duplicate hashes and trash.
The chosen owner's credentials/preferences survive; other credentials, social
features and gacha data are removed. Sessions and API keys must be recreated.
There is no downgrade: restore the backup with the previous release to roll back.
The frozen `legacy_models` package is historical DDL only and must not track live models.
