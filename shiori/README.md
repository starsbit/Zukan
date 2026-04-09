# Shiori

Shiori is an optional standalone companion service for Zukan. It watches liked tweets, downloads attached media, uploads that media into Zukan, and links imported items back to the original post as an external reference.

## What It Does

- Polls liked tweets from a cookie-authenticated X/Twitter account
- Downloads attached media itself
- Uploads media into Zukan through the existing authenticated media API
- Adds the canonical tweet URL as an external reference on the imported media
- Exposes a small documented management API:
  - `GET /health`
  - `GET /status`
  - `GET /config`
  - `PATCH /config`
  - `POST /sync`
- Uses built-in Swagger UI and ReDoc as the management surface:
  - `/docs`
  - `/redoc`

## Runtime

Shiori is meant to run as an optional companion service alongside the Zukan API in Docker Compose.

The compose service is named `shiori`, is enabled through the `shiori` Compose profile, and persists both sync state and stored configuration in a SQLite database mounted at `/data/shiori.db`.

## Configuration

The most important bootstrap environment variables are:

| Variable | Required | Description |
|---|---|---|
| `ZUKAN_BASE_URL` | Yes | Base URL for the Zukan API, usually `http://api:8000` inside Docker Compose. |
| `ZUKAN_TOKEN` | Yes | Zukan bearer token or API key used for authenticated uploads and metadata updates. |
| `TWITTER_AUTH_TOKEN` | Yes | X/Twitter session `auth_token` cookie. |
| `TWITTER_CT0` | Yes | X/Twitter `ct0` CSRF token cookie. |
| `TWITTER_USER_ID` | Yes | Numeric X/Twitter user id for the account whose likes should be synced. |
| `SYNC_INTERVAL_SECONDS` | No | Poll interval for scheduled sync runs. Defaults to `900`. |
| `DEFAULT_VISIBILITY` | No | Visibility sent to Zukan for imported media. Defaults to `private`. |
| `DEFAULT_TAGS` | No | Optional default tags to add on upload. |
| `STATE_DB_PATH` | No | SQLite path for sidecar state. Defaults to `/data/shiori.db`. |
| `SHIORI_NOTIFICATION_COOLDOWN_SECONDS` | No | Cooldown before sending the same alert into Zukan again. Defaults to `21600`. |

After first startup, Shiori stores its own configuration in SQLite and exposes it through the API docs UI. Secrets remain write-only.

## Development

Install dependencies:

```bash
pip install -r shiori/requirements.txt
```

Run the sidecar locally:

```bash
uvicorn shiori.app.main:app --reload --host 0.0.0.0 --port 8010
```

Open the management UI at:

```text
http://localhost:8010/docs
```

Run the sidecar tests:

```bash
pytest shiori/tests
```
