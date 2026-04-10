# Zukan

Self-hosted anime image server. Upload images and video, tag them automatically with AI (WD ViT tagger v3), and browse by character, series, artist, or rating.

---

## Table of Contents

- [Self-hosting](#self-hosting)
  - [Quick install (Proxmox LXC / Debian / Ubuntu)](#quick-install)
  - [Manual install with Docker Compose](#manual-install)
  - [Upgrading](#upgrading)
  - [Configuration](#configuration)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Running locally](#running-locally)
  - [Backend tests](#backend-tests)
  - [E2E tests](#e2e-tests)
- [Releasing (maintainers)](#releasing)
  - [CI/CD overview](#cicd-overview)
  - [Creating a release](#creating-a-release)

---

## Self-hosting

### Quick install

Runs on any Debian 11+ or Ubuntu 22.04+ host, including Proxmox LXC containers.

```bash
curl -fsSL https://raw.githubusercontent.com/starsbit/zukan/main/install.sh | bash
```

The script will:
1. Install Docker and the Compose plugin if not already present
2. Fetch the latest release from GitHub
3. Create `/opt/zukan/` with a `docker-compose.yml` pinned to that version
4. Generate a random `SECRET_KEY` and `POSTGRES_PASSWORD` and write them to `/opt/zukan/.env`
5. Pull the images and start the stack

Once complete the app is available at `http://<host-ip>`. The default login is **admin / admin** — change it immediately via the account settings.

Re-running the script later upgrades to the latest release while preserving your `.env` and all data volumes.

---

### Manual install

**1. Copy the production env template and fill in the two required secrets:**

```bash
cp .env.prod.example .env
# Edit .env — generate SECRET_KEY with: openssl rand -hex 32
```

**2. Start the stack:**

```bash
docker compose -f docker-compose.prod.yml up -d
```

On macOS hosts without NVIDIA GPUs, use the CPU-only compose variant instead:

```bash
docker compose -f docker-compose.prod.macos.yml up -d
```

All other settings (AniList OAuth, tagger thresholds, token expiry, OCR, rate limits, etc.) are configurable through the admin panel after first login — no env vars needed for those.

---

### Upgrading

Edit `docker-compose.prod.yml` and update the image tags to the new version, then:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Database migrations run automatically on startup. Named volumes (`postgres_data`, `storage_data`, `model_cache`) are preserved.

When a new version is available, all users will receive an in-app notification automatically.

---

### Configuration

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes | JWT signing key. Generate with `openssl rand -hex 32`. |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password (used to build `DATABASE_URL` inside the compose file). |

Everything else is configured through the **Admin → App Config** panel after login, including:

- AniList OAuth credentials and redirect URI
- Tagger confidence thresholds
- OCR on/off and language settings
- Access and refresh token expiry
- Upload and auth rate limits
- Thumbnail size and trash purge interval

---

## Development

### Prerequisites

- Docker and Docker Compose
- Python 3.12+ with a virtual environment
- Node.js 24+ and npm (project is developed on Node 25)

### Running locally

**1. Clone and install dependencies:**

```bash
# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt -r backend/requirements-dev.txt

# Frontend
cd frontend && npm ci
```

**2. Copy the dev env file:**

```bash
cp .env.example .env
```

**3. Start the full stack with Docker Compose:**

```bash
docker compose up -d
```

This starts PostgreSQL, the API (port 8000), and the frontend (port 4200). The API rebuilds automatically when the compose file is re-run.

On macOS hosts, use the CPU-only stack file:

```bash
docker compose -f docker-compose.macos.yml up -d
```

For faster backend iteration, run the API outside Docker:

```bash
# With the DB container still running:
uvicorn backend.app.main:api --reload --host 0.0.0.0 --port 8000
```

The API docs (Swagger UI) are available at `http://localhost:8000/docs`.

---

### Backend tests

The test suite uses `pytest` with `testcontainers` — a Postgres container is spun up automatically, no manual DB setup needed.

```bash
# Run all tests
pytest backend/tests

# Run a specific file or test
pytest backend/tests/routers/test_admin.py
pytest backend/tests/routers/test_admin.py::test_admin_app_config_contract

# With coverage
pytest backend/tests --cov=backend/app --cov-report=term-missing
```

---

### E2E tests

E2E tests use Playwright via Angular CLI and run against a full Docker Compose stack.

```bash
# Install Playwright browsers (first time only)
cd frontend && npx playwright install --with-deps chromium

# Run the e2e suite
bash e2e.sh
```

`e2e.sh` builds and starts the stack from `docker-compose.e2e.yml`, waits for the API and frontend to be healthy, runs the tests, and tears the stack down on exit. Logs from the API are printed on failure.

The e2e stack uses an external Docker volume named `zukan_model_cache` to avoid re-downloading the tagger model on each run. Create it once:

```bash
docker volume create zukan_model_cache
```

The model is downloaded into the volume on the first run (~600 MB, takes a few minutes).

---

## Releasing

### CI/CD overview

Two GitHub Actions workflows live in [.github/workflows/](.github/workflows/):

- `ci.yml`
  - Runs backend tests
  - Runs frontend build
  - Runs e2e tests
- `release.yml`
  - Publishes versioned Docker images to GHCR
  - Creates GitHub Releases

---

### Creating a release

1. Ensure all changes are merged to `main` and tests are green.
2. Tag the commit with a semantic version:

```bash
git tag v1.2.3
git push origin v1.2.3
```

3. The `release.yml` workflow runs automatically. It will:
   - Run backend tests, frontend build, and e2e tests in parallel
   - Build `zukan-api` and `zukan-frontend` images with `APP_VERSION=1.2.3` baked in
   - Push both images to GHCR tagged `1.2.3` and `latest`
   - Create a GitHub Release with auto-generated release notes

4. Self-hosters running a previous version will receive an in-app update notification the next time their instance starts.

To delete a tag if something went wrong before the images were pushed:

```bash
git push origin :v1.2.3
```
